// The canonical spelling of a template call of format 50 (engine §2.3,
// "Identity and names"). A marked expression argument prints `= ` and its
// normalized expression, with the parentheses that recover its tree
// (docs/engine.md, "Expression grammar"). Other arguments keep the spellings of format 49.

import { canonicalArgument, templateBodyText } from "../templates.js";
import { stringName } from "../tags.js";
import { methods50 } from "./signatures.js";

// Binding strength, strongest first (docs/engine.md, "Expression grammar").
const LEVEL = { atom: 0, post: 1, sum: 2, inter: 3, union: 4, comparison: 5, neg: 6, conj: 7, disj: 8, implication: 9 };

/** @param {any} node */
function levelOf(node) {
  if (node.concat || node.op === "+") return LEVEL.sum;
  if (node.intersection) return LEVEL.inter;
  if (node.union || node.difference) return LEVEL.union;
  if (node.op !== undefined) return LEVEL.comparison;
  if (node.not !== undefined) return LEVEL.neg;
  if (node.all) return LEVEL.conj;
  if (node.any) return LEVEL.disj;
  if (node.if !== undefined && node.else === undefined) return LEVEL.implication;
  if (node.lambda !== undefined && node.lambda !== "") return LEVEL.implication;
  if (node.property !== undefined || node.method !== undefined || node.map !== undefined || node.flatten !== undefined) return LEVEL.post;
  return LEVEL.atom;
}

/**
 * The canonical spelling of an expression.
 * @param {any} node
 * @param {any} unicode
 * @returns {any}
 */
export function printExpression(node, unicode) {
  /** @param {any} item */
  const print = item => printExpression(item, unicode);
  // An operand that binds more weakly than its place takes parentheses.
  /**
   * @param {any} item
   * @param {any} limit
   */
  const operand = (item, limit) => levelOf(item) > limit ? `(${print(item)})` : print(item);
  if (node.string !== undefined) return stringName(node.string, unicode);
  if (node.integer !== undefined) return node.integer;
  if (node.capture !== undefined) return `$${node.capture}`;
  if (node.const !== undefined) return `$${node.const}`;
  if (node.apply !== undefined) return `$${node.apply}(${print(node.arg)})`;
  if (node.param !== undefined) return `@${node.param}`;
  if (node.item) return "'";
  if (node.pattern !== undefined) return canonicalArgument({ pattern: node.pattern }, unicode);
  if (node.emptySet) return "∅";
  if (node.bag) return `{${node.bag.map((/** @type {any} */ entry) => printEntry(entry, unicode)).join(", ")}}`;
  if (node.list) return `[${node.list.map((/** @type {any} */ item) => prefix(item, unicode) + (item.kind === "splat" ? "*" : "") + print(item.value)).join(", ")}]`;
  if (node.if !== undefined && node.else !== undefined) return `(${print(node.if)} ? ${print(node.then)} | ${print(node.else)})`;
  if (node.if !== undefined) return `${operand(node.if, LEVEL.implication - 1)} ⟹ ${operand(node.then, LEVEL.implication)}`;
  if (node.lambda !== undefined) return node.lambda === "" ? print(node.body) : `$${node.lambda} ↦ ${print(node.body)}`;
  if (node.any) return node.any.map((/** @type {any} */ item) => operand(item, LEVEL.disj - 1)).join(" ∨ ");
  if (node.all) return node.all.map((/** @type {any} */ item) => operand(item, LEVEL.conj - 1)).join(" ∧ ");
  if (node.not !== undefined) return `¬${operand(node.not, LEVEL.neg)}`;
  if (node.op === "+") return `${operand(node.left, LEVEL.sum)} + ${operand(node.right, LEVEL.sum - 1)}`;
  if (node.op !== undefined) return `${operand(node.left, LEVEL.comparison - 1)} ${node.op} ${operand(node.right, LEVEL.comparison - 1)}`;
  if (node.concat) return node.concat.map((/** @type {any} */ item, /** @type {any} */ index) => operand(item, index ? LEVEL.sum - 1 : LEVEL.sum)).join(" ++ ");
  if (node.intersection) return node.intersection.map((/** @type {any} */ item, /** @type {any} */ index) => operand(item, index ? LEVEL.inter - 1 : LEVEL.inter)).join(" ∩ ");
  // A union is flat. A difference after its first operand takes parentheses.
  if (node.union) return node.union.map((/** @type {any} */ item, /** @type {any} */ index) => operand(item, index ? LEVEL.union - 1 : LEVEL.union)).join(" ∪ ");
  if (node.difference) return `${operand(node.difference[0], LEVEL.union)} ∖ ${operand(node.difference[1], LEVEL.union - 1)}`;
  const receiver = node.receiver ? operand(node.receiver, LEVEL.post) : "";
  if (node.property !== undefined) return `${receiver}'${node.property}`;
  if (node.flatten !== undefined) return `${operand(node.flatten, LEVEL.post)}↓`;
  if (node.map !== undefined) {
    const by = node.by;
    const selector = by.property !== undefined && !by.receiver ? `'${by.property}`
      : by.method !== undefined && !by.receiver ? `.${method(by, unicode)}` : `(${print(by)})`;
    return `${operand(node.map, LEVEL.post)}!${selector}`;
  }
  if (node.method !== undefined) return `${receiver}.${method(node, unicode)}`;
  return JSON.stringify(node);
}

/**
 * @param {any} node
 * @param {any} unicode
 */
function method(node, unicode) {
  const takes = (methods50.get(node.method)?.max ?? 0) > 0;
  if (!takes) return node.method;
  const args = node.args.map((/** @type {any} */ arg) => {
    if (arg.key !== undefined) return arg.key;
    if (arg.body !== undefined) return templateBodyText(arg.body, unicode);
    if (arg.rule !== undefined || arg.terminal !== undefined || arg.call !== undefined) return canonicalArgument(arg, unicode);
    return printExpression(arg, unicode);
  });
  const separator = node.method === "followed-by" || node.method === "preceded-by" ? " | " : ", ";
  return `${node.method}(${args.join(separator)})`;
}

/**
 * @param {any} item
 * @param {any} unicode
 */
function prefix(item, unicode) {
  const gates = (item.gates ?? []).map((/** @type {any} */ gate) => `${gate.negated ? "¬" : ""}${gate.feature}? `).join("");
  return gates + (item.guard ? `${printExpression(item.guard, unicode)}? ` : "");
}

/**
 * @param {any} entry
 * @param {any} unicode
 */
function printEntry(entry, unicode) {
  const head = prefix(entry, unicode);
  switch (entry.kind) {
    case "bare": return head + entry.key;
    case "write": return head + entry.keys.map((/** @type {any} */ key) => `${key}: `).join("") + printExpression(entry.value, unicode);
    case "copy": return head + `${printExpression(entry.source, unicode)}'${entry.key}`;
    case "splat": return head + `*${printExpression(entry.value, unicode)}`;
    case "delete": return head + `¬${entry.key}`;
    default: return head + JSON.stringify(entry);
  }
}

/**
 * The canonical spelling of a template call of format 50.
 * @param {any} call a call record of a DOM 50
 * @param {any} unicode
 */
export function printCall(call, unicode) {
  const args = call.args.map((/** @type {any} */ arg) => {
    if (arg.expression) return `= ${printExpression(arg.expression, unicode)}`;
    if (arg.call !== undefined) return printCall(arg, unicode);
    const { at, ...rest } = arg;
    void at;
    return canonicalArgument(rest, unicode);
  });
  return `${call.call}(${args.join(", ")})`;
}
