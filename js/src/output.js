// The canonical result JSON and the renderings of docs/output.md.

import { sortedTagObject } from "./tags.js";

/** @import { Action, ParseError, ParseResult, ResultNode, Span } from "./types.js" */
/** @import { Token } from "./tokens.js" */

/**
 * A token in the result JSON.
 * @typedef {object} TokenJson
 * @property {string} text
 * @property {string} phonemes
 * @property {Record<string, boolean>} tags
 * @property {Span} span
 * @property {Span} source
 * @property {string} [insertedBy]
 */

/**
 * A result tree node in the result JSON.
 * @typedef {{kind: "token", terminal: string, token: number, span: Span, source: Span}
 *   | {kind: "elided", terminal: string, span: Span, source: Span}
 *   | {kind: "rule", rule: string, span: Span, source: Span, tags: Record<string, boolean>, children: NodeJson[]}} NodeJson
 */

/**
 * A witness action in the result JSON.
 * @typedef {{read: {token: number, terminal: string}}
 *   | {close: {rule: string, production: number, span: Span}}} ActionJson
 */

/**
 * An error in the result JSON.
 * @typedef {object} ErrorJson
 * @property {ParseError["kind"]} kind
 * @property {string} [stage]
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {import("./types.js").Expectation[]} [expected]
 * @property {NodeJson[]} [readings]
 * @property {string} [document]
 * @property {string} message
 */

/**
 * A stage in the result JSON.
 * @typedef {object} StageJson
 * @property {string} name
 * @property {import("./types.js").Verdict | null} verdict
 * @property {(ActionJson | null)[]} [witness]
 * @property {NodeJson} [tied]
 * @property {TokenJson[]} [output]
 */

/**
 * The canonical result JSON (docs/output.md).
 * @typedef {object} ResultJson
 * @property {number} format
 * @property {boolean} ok
 * @property {StageJson[]} stages
 * @property {NodeJson | null} tree
 * @property {ErrorJson | null} error
 */

/**
 * The display JSON projection of a tree: each node an object with one
 * member, its rule or terminal.
 * @typedef {{[name: string]: DisplayValue | DisplayValue[] | string | null}} DisplayValue
 */

export const RESULT_FORMAT = 1;

/**
 * @param {Token} token
 * @returns {TokenJson}
 */
function tokenJson(token) {
  /** @type {TokenJson} */
  const result = {
    text: token.text,
    phonemes: token.phonemes || "",
    tags: sortedTagObject(token.tags),
    span: [token.span[0], token.span[1]],
    source: [token.source[0], token.source[1]],
  };
  if (token.insertedBy !== undefined) result.insertedBy = token.insertedBy;
  return result;
}

/**
 * @param {ResultNode} node
 * @returns {NodeJson}
 */
export function nodeJson(node) {
  if (node.kind === "token") return { kind: "token", terminal: node.terminal, token: node.token, span: node.span, source: node.source };
  if (node.kind === "elided") return { kind: "elided", terminal: node.terminal, span: node.span, source: node.source };
  return { kind: "rule", rule: node.rule, span: node.span, source: node.source, tags: sortedTagObject(node.tags), children: node.children.map(nodeJson) };
}

/**
 * @param {Action | null} action
 * @returns {ActionJson | null}
 */
function actionJson(action) {
  if (action === null) return null;
  if (action.kind === "read") return { read: { token: action.token, terminal: action.terminal } };
  const production = action.item.production;
  return { close: { rule: production.owner, production: production.id, span: [action.item.origin, action.item.end] } };
}

/**
 * @param {ParseError} error
 * @returns {ErrorJson}
 */
function errorJson(error) {
  /** @type {Partial<ErrorJson>} */
  const result = { kind: error.kind };
  if (error.stage !== undefined) result.stage = error.stage;
  if (error.token !== undefined) result.token = error.token;
  if (error.source !== undefined) result.source = error.source;
  if (error.line !== undefined) result.line = error.line;
  if (error.column !== undefined) result.column = error.column;
  if (error.expected !== undefined) result.expected = error.expected;
  if (error.readings !== undefined) result.readings = error.readings.map(nodeJson);
  if (error.document !== undefined) result.document = error.document;
  result.message = error.message;
  return /** @type {ErrorJson} */ (result);
}

/**
 * The canonical JSON value of a parse result.
 * @param {ParseResult} result
 * @returns {ResultJson}
 */
export function resultJson(result) {
  return {
    format: RESULT_FORMAT,
    ok: result.ok,
    stages: result.stages.map((stage) => {
      /** @type {StageJson} */
      const json = { name: stage.name, verdict: stage.verdict };
      if (stage.witness) json.witness = stage.witness.map(actionJson);
      if (stage.tied) json.tied = nodeJson(stage.tied);
      if (stage.output) json.output = stage.output.map(tokenJson);
      return json;
    }),
    tree: result.tree ? nodeJson(result.tree) : null,
    error: result.error ? errorJson(result.error) : null,
  };
}

// The tokens a node reads, for its labels.
/**
 * @param {import("./types.js").TokenNode} node
 * @param {Token[]} tokens
 * @returns {string}
 */
function leafLabel(node, tokens) {
  const token = tokens[node.token];
  return token.phonemes ? token.phonemes : token.text;
}

// The bracket rendering (docs/output.md): nested groups cycling ( [ {.
/**
 * @typedef {{leaf: string} | {group: Flat[]}} Flat
 */

/**
 * @param {ParseResult} result
 * @param {{showElided?: boolean}} [options]
 * @returns {string}
 */
export function toBrackets(result, options = {}) {
  if (!result.tree) return "";
  const tokens = finalInput(result);
  /** @type {(node: ResultNode) => Flat | null} */
  const flatten = (node) => {
    if (node.kind === "token") return { leaf: leafLabel(node, tokens) };
    if (node.kind === "elided") return options.showElided ? { leaf: `⟨${node.terminal.toLowerCase()}⟩` } : null;
    const children = /** @type {Flat[]} */ (node.children.map(flatten).filter((child) => child !== null));
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { group: children };
  };
  /** @type {(node: Flat, depth: number) => string} */
  const render = (node, depth) => {
    if ("leaf" in node) return node.leaf;
    const [open, close] = [["(", ")"], ["[", "]"], ["{", "}"]][depth % 3];
    return open + node.group.map((child) => render(child, depth + 1)).join(" ") + close;
  };
  const flat = flatten(result.tree);
  return flat ? render(flat, 0) : "";
}

// The tree rendering: one node per line, single-child chains on one line.
/**
 * @param {ParseResult} result
 * @returns {string}
 */
export function toTree(result) {
  if (!result.tree) return "";
  const tokens = finalInput(result);
  /** @type {string[]} */
  const lines = [];
  /** @type {(node: ResultNode) => string} */
  const label = (node) => {
    if (node.kind === "token") return `${node.terminal} ${JSON.stringify(leafLabel(node, tokens))}`;
    if (node.kind === "elided") return `⟨${node.terminal}⟩`;
    return node.rule;
  };
  /** @type {(node: ResultNode, indent: number) => void} */
  const walk = (node, indent) => {
    const chain = [label(node)];
    let current = node;
    while (current.kind === "rule" && current.children.length === 1 && current.children[0].kind === "rule") {
      current = current.children[0];
      chain.push(label(current));
    }
    let line = " ".repeat(indent) + chain.join(" › ");
    if (current.kind === "rule" && current.children.every((child) => child.kind !== "rule")) {
      const words = current.children.flatMap((child) => (child.kind === "token" ? [leafLabel(child, tokens)] : []));
      if (words.length) line += " · " + words.join(" ");
      lines.push(line);
      return;
    }
    lines.push(line);
    if (current.kind === "rule") for (const child of current.children) walk(child, indent + 2);
  };
  walk(result.tree, 0);
  return lines.join("\n");
}

// The display JSON projection of the tree (docs/output.md).
/**
 * @param {ParseResult} result
 * @returns {DisplayValue | null}
 */
export function displayValue(result) {
  if (!result.tree) return null;
  const tokens = finalInput(result);
  /** @type {(node: ResultNode) => DisplayValue} */
  const project = (node) => {
    if (node.kind === "token") return { [node.terminal]: leafLabel(node, tokens) };
    if (node.kind === "elided") return { [node.terminal]: null };
    const children = node.children.map(project);
    return { [node.rule]: children.length === 1 ? children[0] : children };
  };
  return project(result.tree);
}

// Pretty-prints a JSON value so that single-member objects nest without
// indentation (docs/output.md, "Display JSON").
/**
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
export function prettyJson(value, indent = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  /** @type {(n: number) => string} */
  const pad = (n) => " ".repeat(n);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((item) => pad(indent + 2) + prettyJson(item, indent + 2)).join(",\n") + "\n" + pad(indent) + "]";
  }
  const object = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(object);
  if (keys.length === 1) return `{${JSON.stringify(keys[0])}: ${prettyJson(object[keys[0]], indent)}}`;
  if (keys.length === 0) return "{}";
  return "{\n" + keys.map((key) => `${pad(indent + 2)}${JSON.stringify(key)}: ${prettyJson(object[key], indent + 2)}`).join(",\n") + "\n" + pad(indent) + "}";
}

/**
 * The tokens the last stage read, which its tree's nodes index.
 * @param {ParseResult} result
 * @returns {Token[]}
 */
function finalInput(result) {
  return result.stages[result.stages.length - 1].input || [];
}

