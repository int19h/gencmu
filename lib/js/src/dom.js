// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

import { isTag } from "./tags.js";

/** @import { Argument, GrammarDom, Term } from "./types.js" */

const DOM_FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "runs", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]);
const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆", "⊈"]);
const DOM_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// A capture's name is all lower case (engine §9).
export const CAPTURE_NAME = /^[a-z][a-z0-9-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

// The version of the DOM's shape (docs/output.md), part of every cache key.
export const DOM_FORMAT = 9;

/**
 * What is wrong with a spelling of a symbol (engine §9), or null: an empty
 * spelling, one with a backtick, which the notation cannot write, one that
 * the lowercase mapping would change, since the match ignores stress, or
 * one of anything but a reference, a string or a phoneme tag, `#` included.
 * The spelled symbol is exactly one reference or one terminal, so that no
 * node is read one way here and another way when lowered. Without a table,
 * the lowercase mapping is not checked.
 * @param {unknown} spelling
 * @param {unknown} expr the spelled expression
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {string | null}
 */
export function spellingProblem(spelling, expr, unicode) {
  if (typeof spelling !== "string") return "a malformed spelling";
  if (spelling === "") return "a spelling is empty";
  if (spelling.includes("`")) return "a spelling holds a backtick";
  if (!isDomObject(expr) || Object.keys(expr).length !== 1 ||
      !((typeof expr.ref === "string" && expr.ref !== "#") || typeof expr.terminal === "string")) {
    return "a spelling follows only a reference other than # or a terminal";
  }
  if (unicode && unicode.lowercase(spelling) !== spelling) return `the spelling ${spelling} is not in lower case`;
  return null;
}

/**
 * Whether an expression node has a spelling but is not exactly a spelled
 * symbol: its spelling and its symbol, and no other key that lowering
 * could read in its place.
 * @param {Record<string, unknown>} value
 * @returns {boolean}
 */
function isMisshapenSpelling(value) {
  return "spelling" in value && (Object.keys(value).length !== 2 || !("expr" in value));
}

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
 * Why a value is not a grammar DOM, or null when it is one. `unicode` is
 * the lowercase mapping that spellings are checked against.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {string | null}
 */
export function domProblem(dom, unicode) {
  if (!isDomObject(dom) || dom.format !== DOM_FORMAT || !Array.isArray(dom.rules) || !Array.isArray(dom.directives)) return `not a DOM of format ${DOM_FORMAT}`;
  for (const directive of dom.directives) {
    if (!isDomObject(directive) || typeof directive.name !== "string" || !Array.isArray(directive.args) ||
        !directive.args.every((arg) => typeof arg === "string") || !isDomPosition(directive.at)) return "a malformed directive";
    // The operands the notation's syntax allows these directives (engine §9).
    const args = /** @type {string[]} */ (directive.args);
    if ((directive.name === "stage" && !(args.length === 1 && DOM_NAME.test(args[0]))) ||
        (directive.name === "include" && args.length !== 1) ||
        (directive.name === "features" && !(args.length > 0 && args.every((arg) => DOM_NAME.test(arg)))) ||
        (directive.name === "elidable" && !args.every((arg) => DOM_NAME.test(arg)))) return "a malformed directive";
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
      // The expression itself is checked before its sequence is split.
      if (isDomObject(expr) && isMisshapenSpelling(expr)) return "a malformed expression";
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
      if (!names.every((name) => CAPTURE_NAME.test(name))) return "a capture name is not all lower case";
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
    if ((kind === "expr" || kind === "top-capture") && isMisshapenSpelling(value)) return "a malformed expression";
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
      } else if ("spelling" in value) {
        // A compound node (engine §9) over one symbol.
        const problem = spellingProblem(value.spelling, value.expr, unicode);
        if (problem) return problem;
        push("expr", value.expr);
      } else if (!(typeof value.ref === "string" || isTag(value.terminal, unicode) || value.empty === true)) {
        return "a malformed expression";
      }
    } else if (kind === "top-capture") {
      const inner = value.expr;
      if (typeof value.capture !== "string" || !isDomObject(inner) ||
          !(typeof inner.ref === "string" || isTag(inner.terminal, unicode) || "spelling" in inner)) return "a malformed capture";
      // A capture is a compound node; a spelled symbol below it is checked
      // as any expression is.
      if ("spelling" in inner) push("expr", inner);
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
      // An inserted item is one tag (engine §9).
      if (!items.every((item) => /** @type {Record<string, unknown>} */ (item).insert === undefined || isTag(/** @type {Record<string, unknown>} */ (item).insert, unicode))) return "a malformed emission";
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
      } else if ("union" in value || "intersection" in value || "difference" in value) {
        const items = value.union ?? value.intersection ?? value.difference;
        if (!list(items, 2, "difference" in value ? 2 : Infinity)) return "a malformed term";
        for (const item of /** @type {unknown[]} */ (items)) push("term", item);
      } else if ("call" in value) {
        // The reader's signatures (engine §9), with a span where one is due.
        const args = /** @type {unknown[]} */ (Array.isArray(value.args) ? value.args : []);
        const isRule = (/** @type {unknown} */ arg) => isDomObject(arg) && typeof arg.rule === "string" && Object.keys(arg).length === 1;
        const call = value.call;
        let ok;
        if (typeof call !== "string" || !DOM_FUNCTIONS.has(call) || call === "matches" || call === "begins" || call === "initial") ok = false;
        else if (call === "tags") ok = (args.length === 1 && isDomSpan(args[0])) || (args.length === 2 && isDomSpan(args[0]) && isRule(args[1]));
        else if (call === "lowercase") ok = args.length === 1 && !isRule(args[0]) && !isDomSpan(args[0]);
        else ok = args.length === 1 && isDomSpan(args[0]);
        if (!ok || (!argument && DOM_SPANS.has(/** @type {string} */ (call)))) return "a malformed term";
        for (const arg of args) if (!isRule(arg)) pending.push({ kind: "argument", value: arg, depth: next });
      } else if (!(typeof value.string === "string" || isTag(value.tag, unicode) || value.emptySet === true || typeof value.capture === "string")) {
        return "a malformed term";
      }
    }
  }
  // A definition the reader would refuse (engine §9), and terms and
  // conditions whose types do not agree (engine §10).
  for (const rule of /** @type {any[]} */ (dom.rules)) {
    const problem = definitionProblem(rule) || ruleTypeProblem(rule);
    if (problem) return problem;
  }
  // The order of a document's items is the order of their positions, so no
  // two items share one (engine §9).
  const positions = new Set();
  for (const item of [.../** @type {{at: [number, number]}[]} */ (dom.rules), .../** @type {{at: [number, number]}[]} */ (dom.directives)]) {
    const key = `${item.at[0]}:${item.at[1]}`;
    if (positions.has(key)) return "two items at one position";
    positions.add(key);
  }
  return null;
}

/**
 * Whether a value is a grammar DOM.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {dom is GrammarDom}
 */
export function isDom(dom, unicode) {
  return domProblem(dom, unicode) === null;
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
  for (const key of ["union", "intersection", "difference", "any", "all"]) {
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
  if (Array.isArray(node.difference)) {
    const [left, right] = node.difference.map((item) => simplify(item, has));
    return isEmptySet(left) ? DOM_EMPTY : isEmptySet(right) ? left : { difference: [left, right] };
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

// ---- Types (engine §10) -------------------------------------------------

/**
 * A term's type: a string, a set of strings, a tag set, a span, or a set
 * whose kind nothing has given yet, such as `∅`.
 * @typedef {"string" | "strings" | "tags" | "span" | "set"} TermType
 */

const SET_KINDS = new Set(["strings", "tags", "set"]);
const TYPE_NAMES = { string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", set: "a set" };

/**
 * The type of the value a function gives (engine §10).
 * @param {string} call
 * @returns {TermType}
 */
function callType(call) {
  if (call === "phonemes" || call === "text" || call === "lowercase") return "string";
  if (call === "runs") return "strings";
  if (call === "tags" || call === "classes") return "tags";
  return "span";
}

/**
 * The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined: each
 * is a set, and all whose kind is known have one kind.
 * @param {TermType[]} types
 * @param {string} operator
 * @returns {{type: TermType} | {problem: string}}
 */
export function joinedType(types, operator) {
  if (types.includes("span")) return { problem: "a span is not a value: tags($x) is the tag set of $x" };
  const bad = types.find((type) => !SET_KINDS.has(type));
  if (bad) return { problem: `${operator} joins sets, not ${TYPE_NAMES[bad]}` };
  const kinds = new Set(types.filter((type) => type !== "set"));
  if (kinds.size > 1) return { problem: `${operator} joins two sets of one kind, not a set of strings and a tag set` };
  return { type: kinds.size ? /** @type {TermType} */ ([...kinds][0]) : "set" };
}

/**
 * Why a comparison's two sides do not fit its comparator, or null.
 * @param {string} op
 * @param {TermType} left
 * @param {TermType} right
 * @returns {string | null}
 */
export function comparisonProblem(op, left, right) {
  if (left === "span" || right === "span") return "a span is not a value: tags($x) is the tag set of $x";
  if (op === "∈" || op === "∉") {
    if (left !== "string") return `${op} tests a string, not ${TYPE_NAMES[left]}, in a set of strings; ⊆ and ⊈ compare two sets`;
    if (right !== "strings" && right !== "set") return `${op} tests a string in a set of strings, not in ${TYPE_NAMES[right]}`;
    return null;
  }
  if (op === "⊆" || op === "⊈") {
    const joined = joinedType([left, right], op);
    if ("problem" in joined) return joined.problem;
    return joined.type === "set" ? `the kind of the sets that ${op} compares is not given` : null;
  }
  // = and ≠ compare two values of one type.
  if (left === "string" || right === "string") return left === right ? null : `${op} compares two values of one type, not ${TYPE_NAMES[left]} and ${TYPE_NAMES[right]}`;
  const joined = joinedType([left, right], op);
  if ("problem" in joined) return joined.problem;
  return joined.type === "set" ? `the kind of the sets that ${op} compares is not given` : null;
}

/**
 * Why a term of type `type` cannot stand where `expected` is needed, or
 * null. A set of open kind takes the kind it is given.
 * @param {TermType} type
 * @param {"string" | "tags"} expected
 * @returns {string | null}
 */
export function expectedProblem(type, expected) {
  if (type === expected || (type === "set" && expected === "tags")) return null;
  if (type === "span") return "a span is not a value: tags($x) is the tag set of $x";
  return `${TYPE_NAMES[expected]} is needed here, not ${TYPE_NAMES[type]}`;
}

/**
 * The type of a term, or why its parts do not agree (engine §10). The
 * term's shape must already be checked.
 * @param {any} term
 * @returns {{type: TermType} | {problem: string}}
 */
export function termType(term) {
  if (typeof term.string === "string") return { type: "string" };
  if (typeof term.tag === "string") return { type: "tags" };
  if (term.emptySet === true) return { type: "set" };
  if (typeof term.capture === "string") return { type: "span" };
  for (const [key, operator] of [["union", "∪"], ["intersection", "∩"], ["difference", "∖"]]) {
    if (!Array.isArray(term[key])) continue;
    /** @type {TermType[]} */
    const types = [];
    for (const item of term[key]) {
      const found = termType(item);
      if ("problem" in found) return found;
      types.push(found.type);
    }
    return joinedType(types, operator);
  }
  if ("if" in term) {
    const problem = conditionTypeProblem(term.if);
    if (problem) return { problem };
    const then = termType(term.then);
    if ("problem" in then) return then;
    const wrong = expectedProblem(then.type, "tags");
    return wrong ? { problem: wrong } : { type: "tags" };
  }
  if (typeof term.call === "string") {
    for (const argument of term.args) {
      if ("rule" in argument) continue;
      const found = termType(argument);
      if ("problem" in found) return found;
      if (term.call === "lowercase") {
        const wrong = expectedProblem(found.type, "string");
        if (wrong) return { problem: `lowercase takes one string: ${wrong}` };
      }
    }
    return { type: callType(term.call) };
  }
  return { problem: "a malformed term" };
}

/**
 * Why a condition's terms do not agree in type, or null (engine §10).
 * @param {any} condition
 * @returns {string | null}
 */
export function conditionTypeProblem(condition) {
  if (Array.isArray(condition.any) || Array.isArray(condition.all)) {
    for (const item of condition.any ?? condition.all) {
      const problem = conditionTypeProblem(item);
      if (problem) return problem;
    }
    return null;
  }
  if ("not" in condition) return conditionTypeProblem(condition.not);
  if ("if" in condition) return conditionTypeProblem(condition.if) || conditionTypeProblem(condition.then);
  if (typeof condition.op === "string") {
    const left = termType(condition.left);
    if ("problem" in left) return left.problem;
    const right = termType(condition.right);
    if ("problem" in right) return right.problem;
    return comparisonProblem(condition.op, left.type, right.type);
  }
  return null;
}

/**
 * Why a term that must be a tag set, a constituent's or an item's, is not
 * one, or null.
 * @param {any} term
 * @returns {string | null}
 */
function tagTermProblem(term) {
  const found = termType(term);
  if ("problem" in found) return found.problem;
  return expectedProblem(found.type, "tags");
}

/**
 * Why a rule's terms and conditions do not agree in type, or null.
 * @param {any} rule
 * @returns {string | null}
 */
function ruleTypeProblem(rule) {
  const tagTerms = [rule.tags, ...rule.alternatives.map((/** @type {any} */ alternative) => alternative.tags),
    ...(rule.emit ? rule.emit.items.map((/** @type {any} */ item) => item.tags) : [])];
  for (const term of tagTerms) {
    if (term === undefined) continue;
    const problem = tagTermProblem(term);
    if (problem) return problem;
  }
  for (const condition of rule.conditions) {
    const problem = conditionTypeProblem(condition);
    if (problem) return problem;
  }
  return null;
}
