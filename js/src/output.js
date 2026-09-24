// The canonical result JSON and the renderings of docs/output.md.

import { sortedTagObject } from "./tags.js";
import { foldTree } from "./walk.js";

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
  return foldTree(node,
    /** @returns {NodeJson} */
    (leaf) => (leaf.kind === "token"
      ? { kind: "token", terminal: leaf.terminal, token: leaf.token, span: leaf.span, source: leaf.source }
      : { kind: "elided", terminal: leaf.terminal, span: leaf.span, source: leaf.source }),
    /** @returns {NodeJson} */
    (rule, children) => ({ kind: "rule", rule: rule.rule, span: rule.span, source: rule.source, tags: sortedTagObject(rule.tags), children }));
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
  return nodeBrackets(result.tree, finalInput(result), options);
}

/**
 * The bracket rendering of any tree over the tokens its nodes index: a
 * tied reading, or one of an ambiguous error's readings, as well as a
 * result's tree.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @param {{showElided?: boolean}} [options]
 * @returns {string}
 */
export function nodeBrackets(root, tokens, options = {}) {
  const flat = foldTree(root,
    /** @returns {Flat | null} */
    (leaf) => (leaf.kind === "token" ? { leaf: leafLabel(leaf, tokens) }
      : options.showElided ? { leaf: `⟨${leaf.terminal.toLowerCase()}⟩` } : null),
    /** @returns {Flat | null} */
    (rule, values) => {
      const children = /** @type {Flat[]} */ (values.filter((child) => child !== null));
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      return { group: children };
    });
  if (!flat) return "";
  /** @type {string[]} */
  const parts = [];
  /** @type {{node: Flat, depth: number, next: number}[]} */
  const stack = [{ node: flat, depth: 0, next: -1 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if ("leaf" in node) {
      parts.push(node.leaf);
      stack.pop();
      continue;
    }
    const [open, close] = [["(", ")"], ["[", "]"], ["{", "}"]][frame.depth % 3];
    if (frame.next < 0) {
      parts.push(open);
      frame.next = 0;
    }
    if (frame.next < node.group.length) {
      if (frame.next > 0) parts.push(" ");
      stack.push({ node: node.group[frame.next++], depth: frame.depth + 1, next: -1 });
      continue;
    }
    parts.push(close);
    stack.pop();
  }
  return parts.join("");
}

// The tree rendering: one node per line, single-child chains on one line.
/**
 * @param {ParseResult} result
 * @returns {string}
 */
export function toTree(result) {
  if (!result.tree) return "";
  return nodeTree(result.tree, finalInput(result));
}

/**
 * A tree without its hollow rule nodes, those with no token and no elided
 * terminator below them, such as an empty free-modifier slot: the renderings
 * for people leave them out (docs/output.md).
 * @param {ResultNode} root
 * @returns {ResultNode}
 */
export function withoutHollowNodes(root) {
  return foldTree(root,
    /** @returns {ResultNode} */
    (leaf) => leaf,
    /** @returns {ResultNode} */
    (rule, children) => ({ ...rule, children: children.filter((child) => child.kind !== "rule" || child.children.length > 0) }));
}

/**
 * The tree rendering of any tree over the tokens its nodes index.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @returns {string}
 */
export function nodeTree(root, tokens) {
  /** @type {string[]} */
  const lines = [];
  root = withoutHollowNodes(root);
  /** @type {(node: ResultNode) => string} */
  const label = (node) => {
    if (node.kind === "token") return `${node.terminal} ${JSON.stringify(leafLabel(node, tokens))}`;
    if (node.kind === "elided") return `⟨${node.terminal}⟩`;
    return node.rule;
  };
  /** @type {{node: ResultNode, indent: number}[]} */
  const stack = [{ node: root, indent: 0 }];
  for (let task = stack.pop(); task !== undefined; task = stack.pop()) {
    const { node, indent } = task;
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
      continue;
    }
    lines.push(line);
    if (current.kind === "rule") {
      for (let index = current.children.length - 1; index >= 0; index--) stack.push({ node: current.children[index], indent: indent + 2 });
    }
  }
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
  return foldTree(withoutHollowNodes(result.tree),
    /** @returns {DisplayValue} */
    (leaf) => (leaf.kind === "token" ? { [leaf.terminal]: leafLabel(leaf, tokens) } : { [leaf.terminal]: null }),
    /** @returns {DisplayValue} */
    (rule, children) => ({ [rule.rule]: children.length === 1 ? children[0] : children }));
}

// Pretty-prints a JSON value so that single-member objects nest without
// indentation (docs/output.md, "Display JSON").
/**
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
export function prettyJson(value, indent = 0) {
  /** @type {(n: number) => string} */
  const pad = (n) => " ".repeat(n);
  /** @type {string[]} */
  const out = [];
  // Tasks run last first: a string is written as it is, a value is laid out
  // into further tasks. The stack keeps a deep value from nesting calls.
  /** @type {(string | {value: unknown, indent: number})[]} */
  const tasks = [{ value, indent }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (typeof task === "string") {
      out.push(task);
      continue;
    }
    const current = task.value;
    const at = task.indent;
    if (current === null || typeof current !== "object") {
      out.push(JSON.stringify(current));
      continue;
    }
    /** @type {(string | {value: unknown, indent: number})[]} */
    const layout = [];
    if (Array.isArray(current)) {
      if (current.length === 0) {
        out.push("[]");
        continue;
      }
      layout.push("[\n");
      current.forEach((item, index) => {
        if (index > 0) layout.push(",\n");
        layout.push(pad(at + 2), { value: item, indent: at + 2 });
      });
      layout.push("\n" + pad(at) + "]");
    } else {
      const object = /** @type {Record<string, unknown>} */ (current);
      const keys = Object.keys(object);
      if (keys.length === 0) {
        out.push("{}");
        continue;
      }
      if (keys.length === 1) {
        layout.push(`{${JSON.stringify(keys[0])}: `, { value: object[keys[0]], indent: at }, "}");
      } else {
        layout.push("{\n");
        keys.forEach((key, index) => {
          if (index > 0) layout.push(",\n");
          layout.push(`${pad(at + 2)}${JSON.stringify(key)}: `, { value: object[key], indent: at + 2 });
        });
        layout.push("\n" + pad(at) + "}");
      }
    }
    for (let index = layout.length - 1; index >= 0; index--) tasks.push(layout[index]);
  }
  return out.join("");
}

/**
 * A JSON value as compact text, like `JSON.stringify` with no spacing, but
 * with an explicit stack, since a parse tree can nest deeper than the call
 * stack allows.
 * @param {unknown} value
 * @returns {string}
 */
export function compactJson(value) {
  /** @type {string[]} */
  const out = [];
  /** @type {(string | {value: unknown})[]} */
  const tasks = [{ value }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (typeof task === "string") {
      out.push(task);
      continue;
    }
    const current = task.value;
    if (current === null || typeof current !== "object") {
      out.push(JSON.stringify(current));
      continue;
    }
    /** @type {(string | {value: unknown})[]} */
    const layout = [];
    if (Array.isArray(current)) {
      layout.push("[");
      current.forEach((item, index) => {
        if (index > 0) layout.push(",");
        layout.push({ value: item });
      });
      layout.push("]");
    } else {
      const object = /** @type {Record<string, unknown>} */ (current);
      layout.push("{");
      let first = true;
      for (const key of Object.keys(object)) {
        if (object[key] === undefined) continue;
        if (!first) layout.push(",");
        first = false;
        layout.push(JSON.stringify(key) + ":", { value: object[key] });
      }
      layout.push("}");
    }
    for (let index = layout.length - 1; index >= 0; index--) tasks.push(layout[index]);
  }
  return out.join("");
}

/**
 * The canonical JSON of a parse result as text (docs/output.md).
 * @param {ParseResult} result
 * @returns {string}
 */
export function toJson(result) {
  return compactJson(resultJson(result));
}

/**
 * The tokens the last stage read, which its tree's nodes index.
 * @param {ParseResult} result
 * @returns {Token[]}
 */
function finalInput(result) {
  return result.stages[result.stages.length - 1].input || [];
}

