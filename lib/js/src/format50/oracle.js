// A test mode of the format 50 stage. After the choice of a parse, it
// evaluates each condition and each symbol test of the chosen tree again,
// with the evaluator of late expressions on the real bags. The recognizer
// accepted the tree, so each of them held for it there. An answer that
// differs is a disagreement between recognition and the stage. This module
// shares no code with the bridge, which translates the reads for the
// recognizer. It runs only where a test sets hooks.oracle50.
import { GencmuError } from "../errors.js";
import { rankedOnlyNames } from "./validate.js";

/**
 * @typedef {{stage: string, kind: "condition" | "filter", rule: string, document?: string,
 *   at?: any, answer: boolean | null, detail: string}} Disagreement
 */

/**
 * Checks the chosen tree of one stage.
 * @param {any} root the occurrence of the chosen tree
 * @param {any} derivation the chosen derivation
 * @param {Map<any, any>} made the occurrence of each derivation node
 * @param {any} data the stage data, with its evaluator
 * @param {string} stage
 * @returns {{checked: number, undecided: Disagreement[], disagreements: Disagreement[]}}
 */
export function checkChosenTree(root, derivation, made, data, stage) {
  const result = { checked: 0, undecided: /** @type {Disagreement[]} */ ([]), disagreements: /** @type {Disagreement[]} */ ([]) };
  conditionsOf(root, data, stage, result);
  filtersOf(derivation, made, stage, result);
  return result;
}

/**
 * Each condition of each rule occurrence of the tree holds for it.
 * @param {any} root
 * @param {any} data
 * @param {string} stage
 * @param {any} result
 */
function conditionsOf(root, data, stage, result) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || (node.kind !== "rule" && node.kind !== "splice")) continue;
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    const origin = node.origin;
    if (!origin) continue;
    const rule = origin.rule;
    // A clause whose captures belong to a ranked option qualifies only that
    // option. Where another option won, the clause did not apply.
    const ranked = rankedOnlyNames(origin.alternative.expr);
    const declared = new Set(node.captures.keys());
    for (const written of rule.conditions ?? []) {
      // The loader simplifies the presence tests of the names that this
      // alternative does not declare. The clause applies where the
      // alternative declares every name that remains (docs/notation.md,
      // "Conditions").
      const condition = simplified(written, declared);
      if (condition === true) continue;
      const names = capturesOf(condition === false ? written : condition);
      if (condition !== false && [...names].some(name => !declared.has(name))) continue;
      if ([...names].some(name => ranked.has(name) && !bound(node.captures.get(name)))) continue;
      const scope = { node, captures: boundCaptures(node.captures), declared, items: [], names: new Map(),
        document: origin.document, shared: true };
      result.checked++;
      let answer;
      try {
        answer = condition === false ? false : data.evaluator.truth(condition, scope);
      } catch (error) {
        // A read that the late evaluator cannot run leaves the clause
        // undecided. A failure of the late path itself is counted apart.
        const detail = error instanceof GencmuError ? error.message : `late path failure: ${error instanceof Error ? error.message : String(error)}`;
        result.undecided.push({ stage, kind: "condition", rule: node.rule, document: origin.document, at: written.at, answer: null, detail });
        continue;
      }
      if (answer !== true) {
        result.disagreements.push({ stage, kind: "condition", rule: node.rule, document: origin.document, at: written.at, answer,
          detail: "the recognizer held the condition, and the stage gives false" });
      }
    }
  }
}

/**
 * Each symbol test of the chosen derivation holds of the child that it
 * read: the keys of a tag test on the child's bag, and the value of a value
 * test on the child's value.
 * @param {any} derivation
 * @param {Map<any, any>} made
 * @param {string} stage
 * @param {any} result
 */
function filtersOf(derivation, made, stage, result) {
  const stack = [derivation];
  while (stack.length) {
    const node = stack.pop();
    if (!node || "read" in node || !node.production) continue;
    const rhs = node.production.rhs;
    node.children.forEach((/** @type {any} */ child, /** @type {number} */ index) => {
      stack.push(child);
      const test = rhs[index]?.test;
      if (!test) return;
      const occurrence = made.get(child);
      if (!occurrence) return;
      result.checked++;
      let answer;
      try {
        answer = filterHolds(test, occurrence);
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        result.undecided.push({ stage, kind: "filter", rule: node.production.owner ?? node.production.lhs, answer: null,
          detail: `${test.written}: ${error.message}` });
        return;
      }
      if (!answer) {
        result.disagreements.push({ stage, kind: "filter", rule: node.production.owner ?? node.production.lhs, answer,
          detail: `the recognizer held ${test.written} on ${occurrence.rule ?? occurrence.terminal} at [${occurrence.span}], and its bag fails it` });
      }
    });
  }
}

/**
 * Whether a symbol test holds of an occurrence, read from its bag.
 * @param {any} test
 * @param {any} occurrence
 * @returns {boolean}
 */
function filterHolds(test, occurrence) {
  if (test.inner && !filterHolds(test.inner, occurrence)) return false;
  if (test.op === "tags") {
    for (const key of test.positive ?? []) if (!hasKey(occurrence, key)) return false;
    for (const key of test.negative ?? []) if (hasKey(occurrence, key)) return false;
    return true;
  }
  const value = occurrence.bag().value("value");
  return (value === test.value) === (test.op === "=");
}

/**
 * Whether an occurrence has a key, where an origin test reads its kind.
 * @param {any} occurrence
 * @param {string} key
 */
function hasKey(occurrence, key) {
  // An origin test: a written token, or an omitted leaf.
  if (key === "Written_token") return occurrence.kind === "token";
  if (key === "_Elided") return occurrence.kind === "elided";
  return occurrence.bag().has(key);
}

/**
 * A clause with each presence test of an undeclared name as false, and the
 * truth operators around it folded: true, false or the clause.
 * @param {any} node
 * @param {Set<string>} declared
 * @returns {any}
 */
function simplified(node, declared) {
  if (!node || typeof node !== "object") return node;
  const presence = node.capture !== undefined && node.capture !== "" ? node.capture
    : node.method === "present" && node.receiver?.capture !== undefined && node.receiver.capture !== "" ? node.receiver.capture : null;
  if (presence !== null) return declared.has(presence) ? node : false;
  if (node.not !== undefined) {
    const inner = simplified(node.not, declared);
    return inner === true ? false : inner === false ? true : { ...node, not: inner };
  }
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const conjunction = Array.isArray(node.all);
    const parts = [];
    for (const item of node.all ?? node.any) {
      const part = simplified(item, declared);
      if (part === !conjunction) return !conjunction;
      if (part !== conjunction) parts.push(part);
    }
    if (!parts.length) return conjunction;
    return parts.length === 1 ? parts[0] : { ...node, [conjunction ? "all" : "any"]: parts };
  }
  if (node.if !== undefined) {
    const test = simplified(node.if, declared);
    if (node.else === undefined) {
      if (test === false) return true;
      const then = simplified(node.then, declared);
      if (then === true) return true;
      if (test === true) return then;
      if (then === false) return { not: test };
      return { ...node, if: test, then };
    }
    if (test === true) return simplified(node.then, declared);
    if (test === false) return simplified(node.else, declared);
    return { ...node, if: test };
  }
  return node;
}

/** @param {any} value */
function bound(value) {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
}

/** @param {Map<string, any>} captures */
function boundCaptures(captures) {
  const map = new Map();
  for (const [name, value] of captures) if (value !== null) map.set(name, value);
  return map;
}

/**
 * The capture names that an expression reads, outside the functions that
 * bind them again.
 * @param {any} node
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
function capturesOf(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const item of node) capturesOf(item, into);
    return into;
  }
  if (typeof node.capture === "string" && node.capture !== "") into.add(node.capture);
  for (const value of Object.values(node)) if (value && typeof value === "object") capturesOf(value, into);
  return into;
}
