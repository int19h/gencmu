// The descriptive EBNF uses zero-or-more braces. jbogenbau repeats need one item.
// Source captures do not change recognition. Splices retain their tree effect.
export function syntaxEbnf(dom) {
  function expression(node, nested = false) {
    let text;
    if (node.ref) return node.ref;
    if (node.splice) return `*${typeof node.splice === "string" ? node.splice : expression(node.splice)}`;
    if (node.literal) return JSON.stringify(node.literal.string);
    if (node.empty) return "ε";
    if (node.wildcard) return "ANY-TOKEN";
    if (node.capture !== undefined) return expression(node.expr, nested);
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
  return dom.rules.map(rule => {
    const text = rule.alternatives.map(alt => expression(alt.expr)).join(" | ");
    // The dedicated parse route has a body argument, rather than term arguments.
    const body = rule.name === "named-selector" ? text.replace("method-name", '(method-name - "parse")') : text;
    return `${rule.name} = ${body}`;
  }).join("\n");
}
