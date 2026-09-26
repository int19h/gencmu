// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

/** @import { Argument, GrammarDom, Term } from "./types.js" */

const DOM_FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]);
const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆"]);
const DOM_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

// The version of the DOM's shape (docs/output.md), part of every cache key.
export const DOM_FORMAT = 6;

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

const DOM_SPANS = new Set(["head", "tail", "last", "from", "after"]);

/**
 * Whether a term is a span: a capture, or head, tail or last of one.
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomSpan(value) {
  return isDomObject(value) && (typeof value.capture === "string" || (typeof value.call === "string" && DOM_SPANS.has(value.call)));
}

/**
 * Whether a term is a string: a literal, or phonemes, text or lowercase of
 * something.
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomString(value) {
  return isDomObject(value) && (typeof value.literal === "string" ||
    (typeof value.call === "string" && ["phonemes", "text", "lowercase"].includes(value.call)));
}

/**
 * Why a value is not a grammar DOM, or null when it is one.
 * @param {unknown} dom
 * @returns {string | null}
 */
export function domProblem(dom) {
  if (!isDomObject(dom) || dom.format !== DOM_FORMAT || !Array.isArray(dom.rules) || !Array.isArray(dom.directives)) return `not a DOM of format ${DOM_FORMAT}`;
  for (const directive of dom.directives) {
    if (!isDomObject(directive) || typeof directive.name !== "string" || !Array.isArray(directive.args) ||
        !directive.args.every((arg) => typeof arg === "string") || !isDomPosition(directive.at)) return "a malformed directive";
  }
  /** @type {{kind: string, value: unknown, depth: number}[]} */
  const pending = [];
  for (const rule of dom.rules) {
    if (!isDomObject(rule) || typeof rule.name !== "string" || !(DOM_NAME.test(rule.name) || rule.name === "#") || !["define", "redefine", "extend"].includes(/** @type {string} */ (rule.op)) ||
        !Array.isArray(rule.alternatives) || rule.alternatives.length === 0 || !Array.isArray(rule.conditions) || !isDomPosition(rule.at) ||
        (rule.verbatim !== undefined && rule.verbatim !== true)) {
      return "a malformed rule";
    }
    if (rule.tags !== undefined) pending.push({ kind: "constituent-tags", value: rule.tags, depth: 0 });
    if (rule.emit !== undefined) pending.push({ kind: "emission", value: rule.emit, depth: 0 });
    for (const condition of rule.conditions) pending.push({ kind: "condition", value: condition, depth: 0 });
    for (const alternative of rule.alternatives) {
      if (!isDomObject(alternative) || !Array.isArray(alternative.guards) ||
          !alternative.guards.every((guard) => isDomObject(guard) && typeof guard.feature === "string" && typeof guard.negated === "boolean" &&
            (guard.kind === "gate" || (guard.kind === "warning" && guard.negated === false)))) {
        return "a malformed alternative";
      }
      // A capture stands only at the top level of an alternative: the
      // expression itself or an item of its sequence (engine §3.5).
      // Depth counts the compound nodes above a node (engine §9): the
      // items of a top-level sequence are below one, the sequence.
      const expr = alternative.expr;
      const isSeq = isDomObject(expr) && Array.isArray(expr.seq);
      const top = isSeq ? /** @type {unknown[]} */ (expr.seq) : [expr];
      for (const item of top) {
        if (isDomObject(item) && "capture" in item) pending.push({ kind: "top-capture", value: item, depth: isSeq ? 1 : 0 });
        else pending.push({ kind: "expr", value: item, depth: isSeq ? 1 : 0 });
      }
      if (isDomObject(expr) && Array.isArray(expr.seq) && expr.seq.length < 2) return "a malformed expression";
      const names = top.flatMap((item) => (isDomObject(item) && typeof item.capture === "string" ? [item.capture] : []));
      if (new Set(names).size !== names.length) return "a capture name used twice in an alternative";
      if (names.length > 4) return "more than four captures in an alternative";
      if (names.includes("")) return "a capture that wraps a symbol has a name";
      if (alternative.tags !== undefined) pending.push({ kind: "constituent-tags", value: alternative.tags, depth: 0 });
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
        return "a capture below the top level of an alternative";
      } else if (!(typeof value.ref === "string" || typeof value.terminal === "string" || value.empty === true)) {
        return "a malformed expression";
      }
    } else if (kind === "top-capture") {
      const inner = value.expr;
      if (typeof value.capture !== "string" || !isDomObject(inner) ||
          !(typeof inner.ref === "string" || typeof inner.terminal === "string")) return "a malformed capture";
    } else if (kind === "constituent-tags") {
      // A constituent's tags cannot be made of its own (engine §9).
      if (readsOwnTags(value)) return "a constituent's tags made of its own";
      pending.push({ kind: "term", value, depth });
    } else if (kind === "emission") {
      // The reader's rules (engine §9): $ only with $, a capture listed once,
      // no tags on an inserted tag; no items at all is `ε`.
      if (!list(value.items, 0) || Object.keys(value).length !== 1) return "a malformed emission";
      const items = /** @type {unknown[]} */ (value.items);
      const known = (/** @type {string} */ key) => key === "capture" || key === "insert" || key === "tags";
      if (!items.every((item) => isDomObject(item) && (typeof item.capture === "string") !== (typeof item.insert === "string") && Object.keys(item).every(known))) return "a malformed emission";
      const records = /** @type {Record<string, unknown>[]} */ (items);
      const whole = records.filter((item) => item.capture === "");
      if (whole.length && whole.length !== records.length) return "a malformed emission";
      const captures = records.flatMap((item) => (typeof item.capture === "string" && item.capture !== "" ? [item.capture] : []));
      if (new Set(captures).size !== captures.length) return "a malformed emission";
      for (const item of records) {
        if (item.tags === undefined) continue;
        if (typeof item.insert === "string") return "a malformed emission";
        if (isDomObject(item.tags) && item.tags.emptySet === true) return "a malformed emission";
        // An emission is not a compound node (engine §9): its items' tag
        // terms stand at its own depth.
        pending.push({ kind: "term", value: item.tags, depth });
      }
    } else if (kind === "condition") {
      if ("any" in value || "all" in value) {
        const items = value.any ?? value.all;
        if (!list(items, 2)) return "a malformed condition";
        for (const item of /** @type {unknown[]} */ (items)) push("condition", item);
      } else if ("not" in value) {
        push("condition", value.not);
      } else if ("captured" in value) {
        if (typeof value.captured !== "string" || Object.keys(value).length !== 1) return "a malformed condition";
      } else if ("if" in value) {
        if (Object.keys(value).length !== 2 || !("then" in value)) return "a malformed condition";
        push("condition", value.if);
        push("condition", value.then);
      } else if ("matches" in value || "begins" in value) {
        const span = "matches" in value ? value.matches : value.begins;
        if (typeof value.rule !== "string" || !isDomSpan(span) || ("matches" in value && "begins" in value)) return "a malformed condition";
        pending.push({ kind: "argument", value: span, depth: next });
      } else if ("initial" in value) {
        if (Object.keys(value).length !== 1 || !isDomSpan(value.initial)) return "a malformed condition";
        pending.push({ kind: "argument", value: value.initial, depth: next });
      } else {
        if (typeof value.op !== "string" || !DOM_COMPARATORS.has(value.op)) return "a malformed condition";
        push("term", value.left);
        push("term", value.right);
      }
    } else {
      if ("if" in value) {
        if (Object.keys(value).length !== 2 || !("then" in value)) return "a malformed term";
        push("condition", value.if);
        push("term", value.then);
      } else if ("union" in value || "intersection" in value) {
        const items = value.union ?? value.intersection;
        if (!list(items, 2)) return "a malformed term";
        for (const item of /** @type {unknown[]} */ (items)) push("term", item);
      } else if ("call" in value) {
        // The reader's signatures (engine §9), with a span where one is due.
        const args = /** @type {unknown[]} */ (Array.isArray(value.args) ? value.args : []);
        const isRule = (/** @type {unknown} */ arg) => isDomObject(arg) && typeof arg.rule === "string" && Object.keys(arg).length === 1;
        const call = value.call;
        let ok;
        if (typeof call !== "string" || !DOM_FUNCTIONS.has(call) || call === "matches" || call === "begins" || call === "initial") ok = false;
        else if (call === "tags") ok = (args.length === 1 && isDomSpan(args[0])) || (args.length === 2 && isDomSpan(args[0]) && isRule(args[1]));
        else if (call === "lowercase") ok = args.length === 1 && isDomString(args[0]);
        else ok = args.length === 1 && isDomSpan(args[0]);
        if (!ok || (!argument && DOM_SPANS.has(/** @type {string} */ (call)))) return "a malformed term";
        for (const arg of args) if (!isRule(arg)) pending.push({ kind: "argument", value: arg, depth: next });
      } else if (!(typeof value.literal === "string" || typeof value.weak === "string" || value.emptySet === true || typeof value.capture === "string")) {
        return "a malformed term";
      }
    }
  }
  // A definition the reader would refuse (engine §9).
  for (const rule of /** @type {unknown[]} */ (dom.rules)) {
    const problem = definitionProblem(rule);
    if (problem) return problem;
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

/**
 * Whether a term, or a condition inside one, reads the tags of `$`, the
 * constituent whose tags it may be defining: `$` as a value, `tags($)` or
 * `classes($)`. A span argument such as `phonemes($)` reads tokens, not tags.
 * The DOM's shape need not have been checked: anything malformed reads
 * nothing, and the check of its shape refuses it.
 * @param {unknown} node
 * @returns {boolean}
 */
export function readsOwnTags(node) {
  if (!isDomObject(node)) return false;
  if (node.capture === "" && Object.keys(node).length === 1) return true;
  if (typeof node.call === "string") {
    if (!Array.isArray(node.args)) return false;
    if ((node.call === "tags" || node.call === "classes") && node.args.length === 1) {
      const span = node.args[0];
      return isDomObject(span) && span.capture === "";
    }
    return node.args.some((argument) => isDomObject(argument) && typeof argument.call === "string" && readsOwnTags(argument));
  }
  if ("matches" in node || "begins" in node || "initial" in node) return false;
  for (const key of ["union", "intersection", "any", "all"]) {
    const items = node[key];
    if (Array.isArray(items)) return items.some(readsOwnTags);
  }
  return ["left", "right", "not", "if", "then"].some((key) => readsOwnTags(node[key]));
}

// ---- Clauses against the captures of alternatives (engine §3.6, §9) ----

/** A condition that simplifies to true or false for a production. */
export const DOM_TRUE = Object.freeze({ constant: true });
export const DOM_FALSE = Object.freeze({ constant: false });
/** A term that simplifies to the empty set. */
const DOM_EMPTY = Object.freeze({ emptySet: true });

/**
 * A clause simplified for a production that has the captures `has`: each
 * presence test becomes true or false, and guards and logic over them are
 * reduced (engine §3.6). A condition may become DOM_TRUE or DOM_FALSE; a term may
 * become the empty set.
 * @param {any} node a condition or a term
 * @param {(name: string) => boolean} has
 * @returns {any}
 */
export function simplify(node, has) {
  if (!isDomObject(node)) return node;
  if (typeof node.captured === "string") return has(node.captured) ? DOM_TRUE : DOM_FALSE;
  if ("not" in node) {
    const inner = simplify(node.not, has);
    return inner === DOM_TRUE ? DOM_FALSE : inner === DOM_FALSE ? DOM_TRUE : { not: inner };
  }
  if (Array.isArray(node.all)) {
    const items = node.all.map((item) => simplify(item, has));
    if (items.includes(DOM_FALSE)) return DOM_FALSE;
    const left = items.filter((item) => item !== DOM_TRUE);
    return left.length === 0 ? DOM_TRUE : left.length === 1 ? left[0] : { all: left };
  }
  if (Array.isArray(node.any)) {
    const items = node.any.map((item) => simplify(item, has));
    if (items.includes(DOM_TRUE)) return DOM_TRUE;
    const left = items.filter((item) => item !== DOM_FALSE);
    return left.length === 0 ? DOM_FALSE : left.length === 1 ? left[0] : { any: left };
  }
  if ("if" in node) {
    const antecedent = simplify(node.if, has);
    const isTerm = !isCondition(node.then);
    if (antecedent === DOM_FALSE) return isTerm ? DOM_EMPTY : DOM_TRUE;
    const consequent = simplify(node.then, has);
    if (antecedent === DOM_TRUE) return consequent;
    if (isTerm && isEmptySet(consequent)) return DOM_EMPTY;
    if (!isTerm && consequent === DOM_TRUE) return DOM_TRUE;
    if (!isTerm && consequent === DOM_FALSE) return { not: antecedent };
    return { if: antecedent, then: consequent };
  }
  if (Array.isArray(node.union)) {
    const items = node.union.map((item) => simplify(item, has)).filter((item) => !isEmptySet(item));
    return items.length === 0 ? DOM_EMPTY : items.length === 1 ? items[0] : { union: items };
  }
  if (Array.isArray(node.intersection)) {
    const items = node.intersection.map((item) => simplify(item, has));
    return items.some(isEmptySet) ? DOM_EMPTY : { intersection: items };
  }
  if (typeof node.op === "string") return { op: node.op, left: simplify(node.left, has), right: simplify(node.right, has) };
  if (typeof node.call === "string" && Array.isArray(node.args)) return { call: node.call, args: node.args.map((argument) => simplify(argument, has)) };
  return node;
}

/**
 * Whether a term is the empty set, written or left by a guard.
 * @param {any} node
 * @returns {boolean}
 */
function isEmptySet(node) {
  return isDomObject(node) && node.emptySet === true && Object.keys(node).length === 1;
}

/**
 * Whether a DOM node is a condition rather than a term.
 * @param {any} node
 * @returns {boolean}
 */
function isCondition(node) {
  return isDomObject(node) && (typeof node.op === "string" || "not" in node || "all" in node || "any" in node ||
    "matches" in node || "begins" in node || "initial" in node || "captured" in node || ("if" in node && isCondition(node.then)) || "constant" in node);
}

/**
 * The captures a clause uses as values or spans, presence tests aside.
 * @param {unknown} node
 * @returns {string[]}
 */
export function capturesUsed(node) {
  /** @type {string[]} */
  const names = [];
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.capture === "string" && Object.keys(current).length === 1) names.push(current.capture);
    for (const value of Object.values(current)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

/**
 * The captures a clause mentions at all, presence tests included.
 * @param {unknown} node
 * @returns {string[]}
 */
function capturesMentioned(node) {
  const names = capturesUsed(node);
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.captured === "string") names.push(current.captured);
    for (const value of Object.values(current)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

/**
 * The captures of an alternative's top level, name to position.
 * @param {any} alternative
 * @returns {Map<string, number>}
 */
export function alternativeCaptures(alternative) {
  const top = isDomObject(alternative.expr) && Array.isArray(alternative.expr.seq) ? alternative.expr.seq : [alternative.expr];
  /** @type {Map<string, number>} */
  const captures = new Map([["", -1]]);
  top.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    if (isDomObject(item) && typeof item.capture === "string") captures.set(item.capture, index);
  });
  return captures;
}

/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked.
 * @param {any} rule
 * @returns {string | null}
 */
export function definitionProblem(rule) {
  const alternatives = rule.alternatives.map(alternativeCaptures);
  const anyHas = (/** @type {string} */ name) => alternatives.some((/** @type {Map<string, number>} */ captures) => captures.has(name));
  const items = rule.emit ? rule.emit.items : [];
  // A constituent that does not count cannot sound like its text (engine §9).
  if (rule.verbatim && rule.emit && items.length === 0) return `${rule.name} is verbatim and emits ε`;
  const clauses = [rule.tags, ...rule.conditions, ...rule.alternatives.map((/** @type {any} */ a) => a.tags), ...items];
  // An emission item mentions its own capture, whatever else it says.
  const named = items.flatMap((/** @type {any} */ item) => (typeof item.capture === "string" ? [item.capture] : []));
  for (const name of [...named, ...clauses.flatMap(capturesMentioned)]) {
    if (!anyHas(name)) return `$${name} is captured by no alternative of ${rule.name}`;
  }
  for (const condition of rule.conditions) {
    const applies = alternatives.some((/** @type {Map<string, number>} */ captures) => {
      const simple = simplify(condition, (name) => captures.has(name));
      return simple !== DOM_TRUE && capturesUsed(simple).every((name) => captures.has(name));
    });
    if (!applies) return `a condition of ${rule.name} applies to no alternative`;
  }
  for (let index = 0; index < alternatives.length; index++) {
    const captures = alternatives[index];
    const has = (/** @type {string} */ name) => captures.has(name);
    for (const term of [rule.tags, rule.alternatives[index].tags]) {
      if (term === undefined) continue;
      const missing = capturesUsed(simplify(term, has)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which an alternative lacks; guard it with $${missing} ⟹`;
    }
    if (!rule.emit) continue;
    const present = items.filter((/** @type {any} */ item) => item.capture === undefined || has(item.capture));
    if (items.length > 0 && present.length === 0) return `%emits of ${rule.name} leaves an alternative nothing to emit`;
    const positions = present.flatMap((/** @type {any} */ item) => (item.capture ? [/** @type {number} */ (captures.get(item.capture))] : []));
    if (positions.some((/** @type {number} */ position, /** @type {number} */ at) => at > 0 && position < positions[at - 1])) {
      return `%emits of ${rule.name} lists captures out of the order they stand in`;
    }
    for (const item of present) {
      if (!item.tags) continue;
      const missing = capturesUsed(simplify(item.tags, has)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which an alternative lacks; guard it with $${missing} ⟹`;
    }
  }
  for (let index = 0; index < items.length; index++) {
    if (items[index].insert === undefined) continue;
    const next = items.slice(index + 1).find((/** @type {any} */ item) => item.capture !== undefined);
    if (next && next.capture !== "" && !alternatives.every((/** @type {Map<string, number>} */ captures) => captures.has(next.capture))) {
      return `%emits of ${rule.name} inserts a tag before $${next.capture}, which an alternative lacks`;
    }
  }
  return null;
}
