// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";

// `tree` is the syntax stage's result tree; `tokens` the syntax stage's
// input tokens, whose text is what the author wrote; `positionOf` maps a
// token to its [line, column] in the document.
export function treeToDom(tree, tokens, positionOf, path) {
  const text = (node) => tokens[node.token].text;
  const at = (node) => positionOf(tokens[firstToken(node)]);
  const fail = (message, node) => {
    const [line, column] = at(node);
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  };

  // A rule node's children, with transparent rules read in their place.
  const parts = (node) => {
    const result = [];
    for (const child of node.children) {
      if (child.kind === "rule" && !NAMED.has(child.rule)) result.push(...parts(child));
      else result.push(child);
    }
    return result;
  };
  const tokenText = (node) => (node.kind === "token" ? text(node) : null);
  const ofRule = (node, name) => parts(node).filter((child) => child.kind === "rule" && child.rule === name);
  const one = (node, name) => ofRule(node, name)[0];

  const rules = [];
  const directives = [];
  for (const item of parts(tree)) {
    if (item.rule === "directive-statement") {
      const [directiveToken, ...rest] = parts(item);
      directives.push({
        name: text(directiveToken).slice(1),
        args: rest.filter((child) => child.rule === "argument-word").map((child) => text(parts(child)[0])),
        at: at(item),
      });
    } else if (item.rule === "rule") {
      rules.push(readRule(item));
    }
  }
  return { format: 1, rules, directives };

  function readRule(node) {
    const children = parts(node);
    const name = text(children[0]);
    const definer = one(node, "definer");
    const rule = { name, op: tokenText(parts(definer)[0]) === "|≔" ? "extend" : "define" };
    const tags = one(node, "rule-tags");
    if (tags) rule.tags = readTerm(one(tags, "term"));
    rule.alternatives = ofRule(one(node, "body"), "alternative").map(readAlternative);
    const conditions = [];
    let emit;
    for (const clause of ofRule(node, "clause")) {
      const inner = parts(clause)[0];
      if (inner.rule === "emission") {
        if (emit) fail("a rule may have one ⇒ clause", inner);
        emit = readEmission(inner);
      } else {
        for (const itemNode of ofRule(inner, "condition-item")) conditions.push(readConditionItem(itemNode));
      }
    }
    if (emit) rule.emit = emit;
    rule.conditions = conditions;
    rule.at = at(node);
    return rule;
  }

  function readAlternative(node) {
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(parts(guard)[0]);
      return { feature: spelled.replace(/^@!?/, ""), negated: spelled.startsWith("@!") };
    });
    const alternative = { guards, expr: readExpression(one(node, "conjunction")) };
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = readTerm(one(tags, "term"));
    return alternative;
  }

  function readExpression(node) {
    switch (node.rule) {
      case "choice": {
        const items = ofRule(node, "conjunction").map(readExpression);
        return items.length === 1 ? items[0] : { choice: items };
      }
      case "conjunction": {
        const items = ofRule(node, "sequence").map(readExpression);
        return items.length === 1 ? items[0] : { and: items };
      }
      case "sequence": {
        const items = ofRule(node, "element").map(readExpression);
        return items.length === 1 ? items[0] : { seq: items };
      }
      case "element": {
        const primary = readPrimary(parts(one(node, "primary") || node)[0]);
        const repeated = parts(node).some((child) => tokenText(child) === "...");
        if (!repeated) return primary;
        if (primary.optional !== undefined) return { repeat: primary.optional, min: 0 };
        return { repeat: primary, min: 1 };
      }
      default:
        return fail(`unexpected ${node.rule}`, node);
    }
  }

  function readPrimary(node) {
    switch (node.rule) {
      case "reference": return { ref: text(parts(node)[0]) };
      case "string": return { terminal: decode(parts(node)[0]) };
      case "phoneme": return { terminal: text(parts(node)[0]) };
      case "capture": {
        const [captureToken, , inner] = parts(node);
        const expr = readPrimary(parts(inner)[0]);
        if (expr.ref === undefined && expr.terminal === undefined) fail("a capture wraps one symbol", node);
        return { capture: text(captureToken).slice(1), expr };
      }
      case "group": return readExpression(one(node, "choice"));
      case "optional": return { optional: readExpression(one(node, "choice")) };
      case "hash": return { hash: true };
      case "empty": return { empty: true };
      default: return fail(`unexpected ${node.rule}`, node);
    }
  }

  function readEmission(node) {
    const items = ofRule(node, "emit-item").map((itemNode) => {
      const target = parts(one(itemNode, "emit-target"))[0];
      const kind = target.terminal;
      let item;
      if (kind === "identifier" && text(target) === "this") item = { this: true };
      else if (kind === "identifier" && text(target) === "nothing") item = { nothing: true };
      else if (kind === "capture") item = { capture: text(target).slice(1) };
      else if (kind === "string") item = { insert: decode(target) };
      else if (kind === "phoneme") item = { insert: text(target) };
      else fail("expected this, nothing, a capture or a tag after ⇒", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags) item.tags = readTerm(one(tags, "term"));
      return item;
    });
    if (items.some((item) => item.nothing)) {
      if (items.length !== 1 || items[0].tags) fail("⇒ nothing stands alone", node);
      return { nothing: true };
    }
    if (items.some((item) => item.this) && items.length !== 1) fail("⇒ this stands alone", node);
    return { items };
  }

  function readConditionItem(node) {
    const items = ofRule(node, "condition").map(readCondition);
    return items.length === 1 ? items[0] : { any: items };
  }

  function readCondition(node) {
    const inner = parts(node)[0];
    switch (inner.rule) {
      case "comparison": {
        const [left, comparator, right] = parts(inner);
        return { op: text(parts(comparator)[0]), left: readTerm(left), right: readTerm(right) };
      }
      case "negation":
        return { not: readCondition(one(inner, "condition")) };
      case "call": {
        const call = readCall(inner);
        if (call.call !== "matches" || call.args.length !== 2 || call.args[1].rule === undefined) {
          fail("a condition calls only matches(span, rule)", inner);
        }
        return { matches: call.args[0], rule: call.args[1].rule };
      }
      default:
        return fail(`unexpected ${inner.rule}`, inner);
    }
  }

  function readTerm(node) {
    if (node.rule === "term") {
      const items = ofRule(node, "intersection").map(readTerm);
      return items.length === 1 ? items[0] : { union: items };
    }
    if (node.rule === "intersection") {
      const items = ofRule(node, "term-atom").map(readTerm);
      return items.length === 1 ? items[0] : { intersection: items };
    }
    if (node.rule === "term-atom") {
      const inner = parts(node).find((child) => child.kind === "rule");
      return readTerm(inner);
    }
    switch (node.rule) {
      case "string": return { literal: decode(parts(node)[0]) };
      case "phoneme": return { literal: text(parts(node)[0]) };
      case "weak": return { weak: decode(parts(node)[1]) };
      case "empty-set": return { emptySet: true };
      case "set": return { set: ofRule(node, "term").map(readTerm) };
      case "call": return readCall(node);
      case "capture-reference": return { capture: text(parts(node)[0]).slice(1) };
      default: return fail(`unexpected ${node.rule}`, node);
    }
  }

  function readCall(node) {
    const name = text(parts(node)[0]);
    if (!FUNCTIONS.has(name)) fail(`unknown function ${name}`, node);
    const args = ofRule(node, "argument").map((argument) => {
      const inner = parts(argument)[0];
      if (inner.kind === "token") return { rule: text(inner) };
      return readTerm(inner);
    });
    return { call: name, args };
  }

  function decode(tokenNode) {
    const spelled = [...text(tokenNode)].slice(1, -1);
    let result = "";
    for (let index = 0; index < spelled.length; index++) {
      if (spelled[index] !== "\\") {
        result += spelled[index];
        continue;
      }
      const next = spelled[++index];
      if (next === "\\" || next === '"') result += next;
      else if (next === "u" && spelled[index + 1] === "{") {
        let end = index + 2;
        let hex = "";
        while (end < spelled.length && spelled[end] !== "}") hex += spelled[end++];
        if (end >= spelled.length || !/^[0-9A-Fa-f]{1,6}$/.test(hex)) fail("a bad \\u{...} escape", tokenNode);
        result += String.fromCodePoint(parseInt(hex, 16));
        index = end;
      } else {
        fail(`an unknown escape \\${next || ""}`, tokenNode);
      }
    }
    return result;
  }
}

const FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"]);

// The rules of the notation's syntax grammar that the reader reads; every
// other rule is transparent.
const NAMED = new Set([
  "directive-statement", "argument-word", "rule", "rule-tags", "definer", "body", "alternative", "guard",
  "alternative-tags", "conjunction", "sequence", "element", "primary", "reference", "string", "phoneme",
  "capture", "group", "optional", "choice", "hash", "empty", "clause", "emission", "emit-item", "emit-target",
  "emit-tags", "conditions", "condition-item", "condition", "comparison", "comparator", "negation", "term",
  "intersection", "term-atom", "weak", "empty-set", "set", "call", "argument", "capture-reference",
]);

function firstToken(node) {
  if (node.kind === "token") return node.token;
  for (const child of node.children) {
    if (child.kind === "token") return child.token;
    if (child.kind === "rule") {
      const found = firstToken(child);
      if (found !== undefined) return found;
    }
  }
  return node.span[0];
}
