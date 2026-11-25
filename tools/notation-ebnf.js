import { methods50 } from "./transition/signatures.js";

function only(node, ...keys) {
  for (const key of Object.keys(node)) {
    if (key !== "at" && !keys.includes(key)) throw new Error(`unrepresented field ${key} at ${node.at ?? "unknown position"}`);
  }
}

function prefix({ gates, guard }) {
  return [...gates.map(gate => `${gate.negated ? "¬" : ""}${gate.feature}?`),
    ...(guard ? [`${term(guard)}?`] : [])].map(value => value + " ").join("");
}

// The descriptive EBNF uses zero-or-more braces. A jbogenbau repeat needs one item.
function expression(node, nested = false) {
  if (node.ref) { only(node, "ref"); return node.ref; }
  if (node.splice) { only(node, "splice"); return `*${expression(node.splice)}`; }
  if (node.literal) { only(node, "literal"); return term(node.literal); }
  if (node.empty) { only(node, "empty"); return "ε"; }
  if (node.wildcard) { only(node, "wildcard"); return "ANY-TOKEN"; }
  if (node.remainder) { only(node, "remainder"); return "…"; }
  if (node.capture !== undefined) { only(node, "capture", "expr"); return `$${node.capture}:${expression(node.expr, true)}`; }
  if (node.primary) { only(node, "primary"); return `^${expression(node.primary, true)}`; }
  if (node.optional) { only(node, "optional"); return `[${expression(node.optional)}]`; }
  if (node.repeat) {
    only(node, "repeat", "separator");
    const item = expression(node.repeat, true);
    const tail = node.separator ? `${expression(node.separator, true)} ${item}` : item;
    return `${item} {${tail}}`;
  }
  for (const [key, separator] of [["seq", " "], ["choice", " | "], ["ranked", " ≻ "], ["and", " & "]]) {
    if (node[key]) {
      only(node, key);
      const text = node[key].map(child => expression(child, true)).join(separator);
      return nested ? `(${text})` : text;
    }
  }
  throw new Error(`Unrepresented syntax expression: ${JSON.stringify(node)}`);
}

function term(node) {
  if (node.capture !== undefined) { only(node, "capture"); return `$${node.capture}`; }
  if (node.item) { only(node, "item"); return "'"; }
  if (node.string !== undefined) { only(node, "string"); return JSON.stringify(node.string); }
  if (node.integer !== undefined) { only(node, "integer"); return node.integer; }
  if (node.const) { only(node, "const"); return `$${node.const}`; }
  if (node.param) { only(node, "param"); return `@${node.param}`; }
  if (node.lambda !== undefined) {
    only(node, "lambda", "body");
    return node.lambda ? `$${node.lambda} ↦ ${term(node.body)}` : term(node.body);
  }
  if (node.body) { only(node, "body"); return expression(node.body); }
  if (node.key) { only(node, "key"); return node.key; }
  if (node.property) {
    only(node, "property", "receiver");
    return `${!node.receiver || node.receiver.item ? "" : term(node.receiver)}'${node.property}`;
  }
  if (node.method) {
    only(node, "method", "receiver", "args");
    const sig = methods50.get(node.method);
    if (!sig) throw new Error(`unrepresented method ${node.method}`);
    const targets = ["preceded-by", "followed-by"].includes(node.method);
    const args = node.args.map(arg => targets && (arg.rule || arg.terminal) ? arg.rule ?? arg.terminal : term(arg)).join(targets ? " | " : ", ");
    return `${!node.receiver || node.receiver.item ? "" : term(node.receiver)}.${node.method}${sig.max ? `(${args})` : ""}`;
  }
  if (node.list) {
    only(node, "list");
    return `[${node.list.map(item => {
      only(item, "kind", "value", "gates", "guard");
      if (!["splat", "item"].includes(item.kind)) throw new Error(`unrepresented list item ${item.kind}`);
      return `${prefix(item)}${item.kind === "splat" ? "*" : ""}${term(item.value)}`;
    }).join(", ")}]`;
  }
  if (node.map) {
    only(node, "map", "by");
    const by = term(node.by);
    return `${term(node.map)}!${node.by.method || node.by.property ? by : `(${by})`}`;
  }
  if (node.flatten) { only(node, "flatten"); return `${term(node.flatten)}↓`; }
  if (node.op) { only(node, "op", "left", "right"); return `(${term(node.left)} ${node.op} ${term(node.right)})`; }
  if (node.if) {
    only(node, "if", "then", "else");
    return node.else ? `(${term(node.if)} ? ${term(node.then)} | ${term(node.else)})` :
      `(${term(node.if)} ⟹ ${term(node.then)})`;
  }
  if (node.not) { only(node, "not"); return `¬(${term(node.not)})`; }
  for (const [key, sign] of [["all", "∧"], ["any", "∨"], ["concat", "++"], ["union", "∪"], ["intersection", "∩"], ["difference", "∖"]]) {
    if (node[key]) {
      only(node, key);
      return `(${node[key].map(term).join(` ${sign} `)})`;
    }
  }
  throw new Error(`Unrepresented recognition condition: ${JSON.stringify(node)}`);
}

export function syntaxEbnf(dom) {
  return dom.rules.map(rule => {
    try {
      only(rule, "name", "op", "alternatives", "conditions");
      if (rule.op !== "define") throw new Error(`unrepresented rule operation ${rule.op}`);
      const body = rule.alternatives.map(alt => {
        only(alt, "gates", "expr");
        return prefix(alt) + expression(alt.expr);
      }).join(" | ");
      return [`${rule.name} = ${body}`, ...rule.conditions.map(node => `  assert ${term(node)}`)].join("\n");
    } catch (error) {
      throw new Error(`${rule.name} at ${rule.at.join(":")}: ${error.message}`, { cause: error });
    }
  }).join("\n");
}
