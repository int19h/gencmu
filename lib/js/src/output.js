// The canonical result JSON and the renderings of docs/output.md.

import { sortedTags } from "./tags.js";
import { foldTree } from "./walk.js";

/** @import { WitnessAction, ParseError, ParseResult, ResultNode, Span } from "./types.js" */
/** @import { AttachedToken, Token } from "./tokens.js" */

/**
 * A token in the result JSON.
 * @typedef {object} TokenJson
 * @property {string} text
 * @property {string} phonemes
 * @property {string} label
 * @property {string[]} tags
 * @property {Span} [span] absent for an attached token
 * @property {Span} source
 * @property {string} [insertedBy]
 * @property {TokenJson[]} [before] present only when not empty
 * @property {TokenJson[]} [after] present only when not empty
 */

/**
 * A result tree node in the result JSON.
 * @typedef {{kind: "token", terminal: string, token: number, span: Span, source: Span}
 *   | {kind: "elided", terminal: string, span: Span, source: Span}
 *   | {kind: "rule", rule: string, span: Span, source: Span, tags: string[], children: NodeJson[]}} NodeJson
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
 * @property {"elision-witness-lost"} [code]
 * @property {"tie" | "elision-only"} [reason]
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {import("./types.js").Expectation[]} [expected]
 * @property {NodeJson[]} [readings]
 * @property {string} [document]
 * @property {string} message
 * @property {NodeJson} [chosen]
 * @property {import("./types.js").Restoration[]} [completion]
 */

/**
 * A stage in the result JSON.
 * @typedef {object} StageJson
 * @property {string} name
 * @property {import("./types.js").Verdict | null} verdict
 * @property {(ActionJson | null)[]} [witness]
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
 * @property {WarningJson[]} [warnings] present only when there is one
 */

/**
 * A warning (docs/output.md).
 * @typedef {object} WarningJson
 * @property {string} stage
 * @property {string} feature
 * @property {string} rule
 * @property {[number, number]} span
 * @property {[number, number]} source
 */

/**
 * The display JSON projection of a tree: each node an object with one
 * member, its rule or terminal.
 * @typedef {{[name: string]: DisplayValue | DisplayValue[] | string | string[] | null}} DisplayValue
 */

export const RESULT_FORMAT = 8;

/**
 * A token in the result JSON. An attached token has no span, and a list of
 * attachments is present only when it is not empty (docs/output.md).
 * @param {Token | AttachedToken} token
 * @returns {TokenJson}
 */
function tokenJson(token) {
  /** @type {TokenJson} */
  const result = {
    text: token.text,
    phonemes: token.phonemes || "",
    label: token.label,
    tags: sortedTags(token.tags),
    ...("span" in token ? { span: /** @type {Span} */ ([token.span[0], token.span[1]]) } : {}),
    source: [token.source[0], token.source[1]],
  };
  if (token.insertedBy !== undefined) result.insertedBy = token.insertedBy;
  if (token.before.length > 0) result.before = token.before.map(tokenJson);
  if (token.after.length > 0) result.after = token.after.map(tokenJson);
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
    (rule, children) => ({ kind: "rule", rule: rule.rule, span: rule.span, source: rule.source, tags: sortedTags(rule.tags), children }));
}

/**
 * @param {WitnessAction | null} action
 * @returns {ActionJson | null}
 */
function actionJson(action) {
  if (action === null) return null;
  if (action.kind === "read") return { read: { token: action.token, terminal: action.terminal } };
  return { close: { rule: action.rule, production: action.production, span: [action.span[0], action.span[1]] } };
}

/**
 * @param {ParseError} error
 * @returns {ErrorJson}
 */
function errorJson(error) {
  /** @type {Partial<ErrorJson>} */
  const result = { kind: error.kind };
  if (error.stage !== undefined) result.stage = error.stage;
  if (error.code !== undefined) result.code = error.code;
  if (error.reason !== undefined) result.reason = error.reason;
  if (error.token !== undefined) result.token = error.token;
  if (error.source !== undefined) result.source = error.source;
  if (error.line !== undefined) result.line = error.line;
  if (error.column !== undefined) result.column = error.column;
  if (error.expected !== undefined) result.expected = error.expected;
  if (error.readings !== undefined) result.readings = error.readings.map(nodeJson);
  if (error.document !== undefined) result.document = error.document;
  result.message = error.message;
  // The members of elision-witness-lost follow its message (docs/output.md).
  if (error.chosen !== undefined) result.chosen = nodeJson(error.chosen);
  if (error.completion !== undefined) {
    result.completion = error.completion.map((record) => {
      /** @type {import("./types.js").Restoration} */
      const json = { terminal: record.terminal, at: record.at, source: [record.source[0], record.source[1]] };
      if (record.sound !== undefined) json.sound = record.sound;
      return json;
    });
  }
  return /** @type {ErrorJson} */ (result);
}

/**
 * The canonical JSON value of a parse result.
 * @param {ParseResult} result
 * @returns {ResultJson}
 */
export function resultJson(result) {
  /** @type {ResultJson} */
  const json = {
    format: RESULT_FORMAT,
    ok: result.ok,
    stages: result.stages.map((stage) => {
      /** @type {StageJson} */
      const json = { name: stage.name, verdict: stage.verdict };
      if (stage.witness) json.witness = stage.witness.map(actionJson);
      if (stage.output) json.output = stage.output.map(tokenJson);
      return json;
    }),
    tree: result.tree ? nodeJson(result.tree) : null,
    error: result.error ? errorJson(result.error) : null,
  };
  if (result.warnings && result.warnings.length > 0) {
    json.warnings = result.warnings.map((warning) => ({
      stage: warning.stage, feature: warning.feature, rule: warning.rule, span: [warning.span[0], warning.span[1]], source: [warning.source[0], warning.source[1]],
    }));
  }
  return json;
}

// The tokens a node reads, for its labels.
/**
 * @param {import("./types.js").TokenNode} node
 * @param {Token[]} tokens
 * @returns {string}
 */
function leafLabel(node, tokens) {
  // Every rendering shows a token by its label (docs/output.md).
  return tokens[node.token].label;
}

/**
 * A token's classes, its tags that begin with a capital, in code point
 * order: how the renderings name an attached token (docs/output.md).
 * @param {AttachedToken} token
 * @returns {string[]}
 */
function classesOf(token) {
  return sortedTags(token.tags).filter((tag) => /^[A-Z]/.test(tag));
}

/**
 * A token's attachments on one line, for the token tables: `◂ ` before a
 * before-attachment and `▸ ` before an after-attachment, each with its
 * classes and its label, and its own attachments after it in parentheses.
 * The empty string for a token with none.
 * @param {AttachedToken} token
 * @returns {string}
 */
export function attachmentText(token) {
  /** @type {string[]} */
  const parts = [];
  for (const [mark, list] of /** @type {[string, AttachedToken[]][]} */ ([["◂ ", token.before], ["▸ ", token.after]])) {
    for (const attachment of list) {
      const classes = classesOf(attachment);
      const inner = attachmentText(attachment);
      parts.push(mark + (classes.length ? classes.join(" ∪ ") + " " : "") + JSON.stringify(attachment.label) + (inner ? ` (${inner})` : ""));
    }
  }
  return parts.join(", ");
}

/**
 * Whether a token or any of its attachments has a label with a line break.
 * @param {AttachedToken} token
 * @returns {boolean}
 */
function breaksLine(token) {
  return /[\n\r]/.test(token.label) || [...token.before, ...token.after].some(breaksLine);
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
  // A token with attachments is a group of its before-attachments, its
  // label and its after-attachments, each rendered the same way.
  /** @type {(token: AttachedToken) => Flat} */
  const tokenFlat = (token) => (token.before.length === 0 && token.after.length === 0 ? { leaf: token.label }
    : { group: [...token.before.map(tokenFlat), { leaf: token.label }, ...token.after.map(tokenFlat)] });
  const flat = foldTree(root,
    /** @returns {Flat | null} */
    (leaf) => (leaf.kind === "token" ? tokenFlat(tokens[leaf.token])
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
  return nodeTree(result.tree, finalInput(result), result.text);
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
 * The tree rendering of any tree over the tokens its nodes index. `text` is
 * the text that the tokens' sources index. Without it, only the labels
 * decide whether a rule's tokens fit on its line.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @param {string} [text]
 * @returns {string}
 */
export function nodeTree(root, tokens, text) {
  /** @type {string[]} */
  const lines = [];
  root = withoutHollowNodes(root);
  const characters = text === undefined ? undefined : [...text];
  // Whether a summary of tokens stays on one line: no label holds a line
  // break, and, when the text is known, no line break, `\n` or `\r`, lies
  // between the least start and the greatest end of their sources, which
  // need not be in text order (engine §1, docs/output.md).
  /** @type {(children: import("./types.js").TokenNode[]) => boolean} */
  const oneLine = (children) => {
    // A token with attachments shows them on lines of its own, so its rule
    // is never one line (docs/output.md).
    if (children.some((child) => tokens[child.token].before.length > 0 || tokens[child.token].after.length > 0)) return false;
    if (children.some((child) => breaksLine(tokens[child.token]))) return false;
    if (characters === undefined) return true;
    let start = Infinity;
    let end = -Infinity;
    for (const child of children) {
      const [from, to] = tokens[child.token].source;
      start = Math.min(start, from);
      end = Math.max(end, to);
    }
    for (let index = start; index < end && index < characters.length; index++) {
      if (characters[index] === "\n" || characters[index] === "\r") return false;
    }
    return true;
  };
  /** @type {(node: ResultNode) => string} */
  const label = (node) => {
    if (node.kind === "token") return `${node.terminal} ${JSON.stringify(leafLabel(node, tokens))}`;
    if (node.kind === "elided") return `⟨${node.terminal}⟩`;
    return node.rule;
  };
  // A token's attachments, each on a line of its own under it: `◂ ` before a
  // before-attachment and `▸ ` before an after-attachment, with its classes
  // and its label, and its own attachments under it (docs/output.md).
  /** @type {(token: AttachedToken, indent: number) => void} */
  const attachmentLines = (token, indent) => {
    for (const [mark, list] of /** @type {[string, AttachedToken[]][]} */ ([["◂ ", token.before], ["▸ ", token.after]])) {
      for (const attachment of list) {
        const classes = classesOf(attachment);
        lines.push(" ".repeat(indent) + mark + (classes.length ? classes.join(" ∪ ") + " " : "") + JSON.stringify(attachment.label));
        attachmentLines(attachment, indent + 2);
      }
    }
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
    // A rule with only tokens below it, all on one line of source, is one
    // line; an elided terminator is a line of its own (docs/output.md).
    const leaves = current.kind === "rule" ? current.children.flatMap((child) => (child.kind === "token" ? [child] : [])) : [];
    if (current.kind === "rule" && leaves.length === current.children.length && (leaves.length === 0 || oneLine(leaves))) {
      if (leaves.length) line += " · " + leaves.map((child) => leafLabel(child, tokens)).join(" ");
      lines.push(line);
      continue;
    }
    lines.push(line);
    if (current.kind === "token") attachmentLines(tokens[current.token], indent + 2);
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
  // An attachment: its classes, its label and its own attachments, each
  // list left out when it is empty (docs/output.md).
  /** @type {(token: AttachedToken) => DisplayValue} */
  const attachment = (token) => {
    const classes = classesOf(token);
    return { ...(classes.length ? { classes } : {}), label: token.label, ...attachmentsOf(token) };
  };
  /** @type {(token: AttachedToken) => DisplayValue} */
  const attachmentsOf = (token) => ({
    ...(token.before.length ? { before: token.before.map(attachment) } : {}),
    ...(token.after.length ? { after: token.after.map(attachment) } : {}),
  });
  /** @type {(leaf: import("./types.js").TokenNode) => DisplayValue} */
  const tokenValue = (leaf) => {
    const token = tokens[leaf.token];
    if (token.before.length === 0 && token.after.length === 0) return { [leaf.terminal]: token.label };
    return { terminal: leaf.terminal, label: token.label, ...attachmentsOf(token) };
  };
  return foldTree(withoutHollowNodes(result.tree),
    /** @returns {DisplayValue} */
    (leaf) => (leaf.kind === "token" ? tokenValue(leaf) : { [leaf.terminal]: null }),
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

