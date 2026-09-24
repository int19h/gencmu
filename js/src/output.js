// The canonical result JSON and the renderings of docs/output.md.

import { sortedTagObject, compareCodePoints } from "./tags.js";

export const RESULT_FORMAT = 1;

function tokenJson(token) {
  const result = {
    text: token.text,
    phonemes: token.phonemes || "",
    tags: sortedTagObject(token.tags),
    span: token.span.slice(),
    source: token.source.slice(),
  };
  if (token.insertedBy !== undefined) result.insertedBy = token.insertedBy;
  return result;
}

export function nodeJson(node) {
  if (node.kind === "token") return { kind: "token", terminal: node.terminal, token: node.token, span: node.span, source: node.source };
  if (node.kind === "elided") return { kind: "elided", terminal: node.terminal, span: node.span, source: node.source };
  return { kind: "rule", rule: node.rule, span: node.span, source: node.source, tags: sortedTagObject(node.tags), children: node.children.map(nodeJson) };
}

function actionJson(action) {
  if (action.kind === "read") return { read: { token: action.token, terminal: action.terminal } };
  const production = action.item.production;
  return { close: { rule: production.owner, production: production.id, span: [action.item.origin, action.item.end] } };
}

function errorJson(error) {
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
  return result;
}

// The canonical JSON value of a parse result.
export function resultJson(result) {
  return {
    format: RESULT_FORMAT,
    ok: result.ok,
    stages: result.stages.map((stage) => {
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
function leafLabel(node, tokens) {
  const token = tokens[node.token];
  return token.phonemes ? token.phonemes : token.text;
}

// The bracket rendering (docs/output.md): nested groups cycling ( [ {.
export function toBrackets(result, options = {}) {
  if (!result.tree) return "";
  const stage = result.stages[result.stages.length - 1];
  const tokens = stage.input;
  const flatten = (node) => {
    if (node.kind === "token") return { leaf: leafLabel(node, tokens) };
    if (node.kind === "elided") return options.showElided ? { leaf: `⟨${node.terminal.toLowerCase()}⟩` } : null;
    const children = node.children.map(flatten).filter((child) => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { group: children };
  };
  const render = (node, depth) => {
    if (node.leaf !== undefined) return node.leaf;
    const [open, close] = [["(", ")"], ["[", "]"], ["{", "}"]][depth % 3];
    return open + node.group.map((child) => render(child, depth + 1)).join(" ") + close;
  };
  const flat = flatten(result.tree);
  return flat ? render(flat, 0) : "";
}

// The tree rendering: one node per line, single-child chains on one line.
export function toTree(result) {
  if (!result.tree) return "";
  const stage = result.stages[result.stages.length - 1];
  const tokens = stage.input;
  const lines = [];
  const label = (node) => {
    if (node.kind === "token") return `${node.terminal} ${JSON.stringify(leafLabel(node, tokens))}`;
    if (node.kind === "elided") return `⟨${node.terminal}⟩`;
    return node.rule;
  };
  const walk = (node, indent) => {
    const chain = [label(node)];
    let current = node;
    while (current.kind === "rule" && current.children.length === 1 && current.children[0].kind === "rule") {
      current = current.children[0];
      chain.push(label(current));
    }
    let line = " ".repeat(indent) + chain.join(" › ");
    if (current.kind === "rule" && current.children.every((child) => child.kind !== "rule")) {
      const words = current.children.filter((child) => child.kind === "token").map((child) => leafLabel(child, tokens));
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
export function displayValue(result) {
  if (!result.tree) return null;
  const tokens = result.stages[result.stages.length - 1].input;
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
export function prettyJson(value, indent = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const pad = (n) => " ".repeat(n);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((item) => pad(indent + 2) + prettyJson(item, indent + 2)).join(",\n") + "\n" + pad(indent) + "]";
  }
  const keys = Object.keys(value);
  if (keys.length === 1) return `{${JSON.stringify(keys[0])}: ${prettyJson(value[keys[0]], indent)}}`;
  if (keys.length === 0) return "{}";
  return "{\n" + keys.map((key) => `${pad(indent + 2)}${JSON.stringify(key)}: ${prettyJson(value[key], indent + 2)}`).join(",\n") + "\n" + pad(indent) + "}";
}

void compareCodePoints;
