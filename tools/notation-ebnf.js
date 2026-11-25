import { operandFields50, recordKind50 } from "../lib/js/src/format50/records.js";
import { methods50 } from "../lib/js/src/format50/signatures.js";

function only(node, ...keys) {
  for (const key of Object.getOwnPropertyNames(node).sort()) {
    if (key !== "at" && !keys.includes(key)) throw new Error(`unrepresented field ${key} at ${node.at ?? "unknown position"}`);
  }
}

function prefix({ gates, guard }) {
  return [...gates.map(gate => `${gate.negated ? "¬" : ""}${gate.feature}?`),
    ...(guard ? [`${term(guard)}?`] : [])].map(value => value + " ").join("");
}

// The descriptive EBNF uses zero-or-more braces. A jbogenbau repeat needs one item.
function expression(node, nested = false) {
  const kind = recordKind50(node, "body");
  if (kind === "reference") { only(node, "ref"); return node.ref; }
  if (kind === "splice") { only(node, "splice"); return `*${expression(node.splice)}`; }
  if (kind === "literal") { only(node, "literal"); return term(node.literal); }
  if (kind === "empty") { only(node, "empty"); return "ε"; }
  if (kind === "wildcard") { only(node, "wildcard"); return "ANY-TOKEN"; }
  if (kind === "remainder") { only(node, "remainder"); return "…"; }
  if (kind === "captureSymbol") { only(node, "capture", "expr"); return `$${node.capture}:${expression(node.expr, true)}`; }
  if (kind === "primary") { only(node, "primary"); return `^${expression(node.primary, true)}`; }
  if (kind === "optional") { only(node, "optional"); return `[${expression(node.optional)}]`; }
  if (kind === "repeat") {
    only(node, "repeat", "separator");
    const item = expression(node.repeat, true);
    const tail = node.separator ? `${expression(node.separator, true)} ${item}` : item;
    return `${item} {${tail}}`;
  }
  const separator = { sequence: " ", choice: " | ", ranked: " ≻ ", subset: " & " }[kind];
  if (separator) {
    const [key, operands] = operandFields50(node, "body")[0];
    only(node, key);
    const text = operands.map(child => expression(child, true)).join(separator);
    return nested ? `(${text})` : text;
  }
  throw new Error(`Unrepresented syntax expression at ${node.at ?? "unknown position"}`);
}

function term(node, slot = "expression") {
  const kind = recordKind50(node, slot);
  if (kind === "capture") { only(node, "capture"); return `$${node.capture}`; }
  if (kind === "implicitItem") { only(node, "item"); return "'"; }
  if (kind === "string") { only(node, "string"); return JSON.stringify(node.string); }
  if (kind === "integer") { only(node, "integer"); return node.integer; }
  if (kind === "constantReference") { only(node, "const"); return `$${node.const}`; }
  if (kind === "parameter") { only(node, "param"); return `@${node.param}`; }
  if (kind === "lambda") {
    only(node, "lambda", "body");
    return node.lambda ? `$${node.lambda} ↦ ${term(node.body)}` : term(node.body);
  }
  if (kind === "query") { only(node, "body"); return expression(node.body); }
  if (kind === "keyArgument") { only(node, "key"); return node.key; }
  if (kind === "property" || kind === "shortProperty") {
    only(node, "property", "receiver");
    return `${!node.receiver || node.receiver.item ? "" : term(node.receiver)}'${node.property}`;
  }
  if (kind === "method" || kind === "shortMethod") {
    only(node, "method", "receiver", "args");
    const sig = methods50.get(node.method);
    if (!sig) throw new Error(`unrepresented method ${node.method}`);
    const receiver = !node.receiver || node.receiver.item ? "" : term(node.receiver);
    const targets = ["preceded-by", "followed-by"].includes(node.method);
    const args = node.args.map(arg => targets && (arg.rule || arg.terminal) ? arg.rule ?? arg.terminal : term(arg, "methodArgument")).join(targets ? " | " : ", ");
    return `${receiver}.${node.method}${sig.max ? `(${args})` : ""}`;
  }
  if (kind === "list") {
    only(node, "list");
    return `[${node.list.map(item => {
      only(item, "kind", "value", "gates", "guard");
      if (!["splat", "item"].includes(item.kind)) throw new Error(`unrepresented list item ${item.kind}`);
      return `${prefix(item)}${item.kind === "splat" ? "*" : ""}${term(item.value)}`;
    }).join(", ")}]`;
  }
  if (kind === "map") {
    only(node, "map", "by");
    const receiver = term(node.map);
    const by = term(node.by, "selector");
    return `${receiver}!${node.by.method || node.by.property ? by : `(${by})`}`;
  }
  if (kind === "flatten") { only(node, "flatten"); return `${term(node.flatten)}↓`; }
  if (kind === "comparison") { only(node, "op", "left", "right"); return `(${term(node.left)} ${node.op} ${term(node.right)})`; }
  if (kind === "conditional" || kind === "implication") {
    only(node, "if", "then", "else");
    return node.else ? `(${term(node.if)} ? ${term(node.then)} | ${term(node.else)})` :
      `(${term(node.if)} ⟹ ${term(node.then)})`;
  }
  if (kind === "negation") { only(node, "not"); return `¬(${term(node.not)})`; }
  const sign = { conjunction: "∧", disjunction: "∨", concat: "++", union: "∪", intersection: "∩", difference: "∖" }[kind];
  if (sign) {
    const [key, operands] = operandFields50(node, slot)[0];
    only(node, key);
    return `(${operands.map(part => term(part)).join(` ${sign} `)})`;
  }
  throw new Error(`Unrepresented recognition condition at ${node.at ?? "unknown position"}`);
}

export function syntaxEbnf(dom) {
  return dom.rules.map(rule => {
    try {
      only(rule, "name", "op", "alternatives", "conditions");
      if (rule.op !== "define") throw new Error(`unrepresented rule operation ${rule.op}`);
      const body = rule.alternatives.map(alt => {
        only(alt, "gates", "expr");
        const kind = recordKind50(alt.expr, "body");
        const choice = kind === "choice" || kind === "ranked";
        const grouped = Boolean(choice && rule.alternatives.length > 1 ||
          (choice || kind === "subset" || kind === "sequence") && alt.gates.length);
        return prefix(alt) + expression(alt.expr, grouped);
      }).join(" | ");
      return [`${rule.name} = ${body}`, ...rule.conditions.map(node => `  assert ${term(node)}`)].join("\n");
    } catch (error) {
      throw new Error(`${rule.name} at ${rule.at.join(":")}: ${error.message}`, { cause: error });
    }
  }).join("\n");
}
