// The descriptive EBNF uses zero-or-more braces. jbogenbau repeats need one item.
// Captures name the spans that recognition assertions inspect. Splices retain their tree effect.
export function syntaxEbnf(dom) {
  function expression(node, nested = false) {
    let text;
    if (node.ref) return node.ref;
    if (node.splice) return `*${typeof node.splice === "string" ? node.splice : expression(node.splice)}`;
    if (node.literal) return JSON.stringify(node.literal.string);
    if (node.empty) return "ε";
    if (node.wildcard) return "ANY-TOKEN";
    if (node.remainder) return "…";
    if (node.capture !== undefined) return `$${node.capture}:${expression(node.expr, true)}`;
    if (node.optional) return `[${expression(node.optional)}]`;
    if (node.repeat) {
      const item = expression(node.repeat, true);
      return node.separator ? `${item} {${expression(node.separator, true)} ${item}}` : `${item} {${item}}`;
    }
    if (node.test) {
      if (node.test === "≠" && node.value?.string !== undefined) return `(${expression(node.expr)} - ${JSON.stringify(node.value.string)})`;
      throw new Error(`Unrepresented syntax test: ${JSON.stringify(node)}`);
    }
    for (const [key, separator] of [["seq", " "], ["choice", " | "], ["ranked", " ≻ "]]) {
      if (node[key]) {
        text = node[key].map(child => expression(child, key === "seq")).join(separator);
        return nested && key !== "seq" ? `(${text})` : text;
      }
    }
    throw new Error(`Unrepresented syntax expression: ${JSON.stringify(node)}`);
  }
  function term(node) {
    if (node.capture !== undefined) return `$${node.capture}`;
    if (node.string !== undefined) return JSON.stringify(node.string);
    if (node.concat) return `(${node.concat.map(term).join(" ++ ")})`;
    if (node.method) {
      const args = node.args.map(arg => arg.body ? expression(arg.body) : term(arg));
      return `${term(node.receiver)}.${node.method}${args.length ? `(${args.join(", ")})` : ""}`;
    }
    throw new Error(`Unrepresented assertion term: ${JSON.stringify(node)}`);
  }
  function condition(node) {
    if (node.op) return `(${term(node.left)} ${node.op} ${term(node.right)})`;
    if (node.if) return `(${condition(node.if)} ⟹ ${condition(node.then)})`;
    if (node.not) return `¬(${condition(node.not)})`;
    if (node.captured !== undefined) return `$${node.captured}`;
    if (node.method) return term(node);
    for (const [key, sign] of [["all", "∧"], ["any", "∨"]]) {
      if (node[key]) return `(${node[key].map(condition).join(` ${sign} `)})`;
    }
    throw new Error(`Unrepresented recognition condition: ${JSON.stringify(node)}`);
  }
  return dom.rules.map(rule => {
    const body = rule.alternatives.map(alt => expression(alt.expr)).join(" | ");
    return [`${rule.name} = ${body}`, ...rule.conditions.map(node => `  assert ${condition(node)}`)].join("\n");
  }).join("\n");
}
