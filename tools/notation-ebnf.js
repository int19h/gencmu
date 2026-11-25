// The descriptive EBNF uses zero-or-more braces. A jbogenbau repeat needs one item.
function expression(node, nested = false) {
  if (node.ref) return node.ref;
  if (node.splice) return `*${expression(node.splice)}`;
  if (node.literal) return term(node.literal);
  if (node.empty) return "ε";
  if (node.wildcard) return "ANY-TOKEN";
  if (node.remainder) return "…";
  if (node.capture !== undefined) return `$${node.capture}:${expression(node.expr, true)}`;
  if (node.primary) return `^${expression(node.primary, true)}`;
  if (node.optional) return `[${expression(node.optional)}]`;
  if (node.repeat) {
    const item = expression(node.repeat, true);
    const tail = node.separator ? `${expression(node.separator, true)} ${item}` : item;
    return `${item} {${tail}}`;
  }
  for (const [key, separator] of [["seq", " "], ["choice", " | "], ["ranked", " ≻ "], ["and", " & "]]) {
    if (node[key]) {
      const text = node[key].map(child => expression(child, true)).join(separator);
      return nested ? `(${text})` : text;
    }
  }
  throw new Error(`Unrepresented syntax expression: ${JSON.stringify(node)}`);
}

function term(node) {
  if (node.capture !== undefined) return `$${node.capture}`;
  if (node.item) return "'";
  if (node.string !== undefined) return JSON.stringify(node.string);
  if (node.integer !== undefined) return node.integer;
  if (node.const) return `$${node.const}`;
  if (node.body && !Object.hasOwn(node, "lambda")) return expression(node.body);
  if (node.key) return node.key;
  if (node.property) return `${!node.receiver || node.receiver.item ? "" : term(node.receiver)}'${node.property}`;
  if (node.method) {
    const args = node.args.map(arg => term(arg)).join(", ");
    return `${!node.receiver || node.receiver.item ? "" : term(node.receiver)}.${node.method}${node.args.length || node.method === "join" ? `(${args})` : ""}`;
  }
  if (node.list) return `[${node.list.map(item => term(item.value)).join(", ")}]`;
  if (node.map) return `${term(node.map)}!${term(node.by)}`;
  if (node.op) return `(${term(node.left)} ${node.op} ${term(node.right)})`;
  if (node.if) return `(${term(node.if)} ⟹ ${term(node.then)})`;
  if (node.not) return `¬(${term(node.not)})`;
  for (const [key, sign] of [["all", "∧"], ["any", "∨"], ["concat", "++"]]) {
    if (node[key]) return `(${node[key].map(term).join(` ${sign} `)})`;
  }
  throw new Error(`Unrepresented recognition condition: ${JSON.stringify(node)}`);
}

export function syntaxEbnf(dom) {
  return dom.rules.map(rule => {
    const body = rule.alternatives.map(alt => expression(alt.expr)).join(" | ");
    return [`${rule.name} = ${body}`, ...rule.conditions.map(node => `  assert ${term(node)}`)].join("\n");
  }).join("\n");
}
