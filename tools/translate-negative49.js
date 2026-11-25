// Negative counterparts preserve the failing operand rather than applying
// the coercions used to translate successful expressions.
const matrixConstants = [
  ['%const $S "ab"', '%const $S "ab"'],
  ['%const $Q ("a" "b")', '%const $Q ["a", "b"]'],
  ['%const $TAG (A B)', '%const $TAG {A, B}'],
  ['%const $P #A', '%const $P #A'],
  ['%const $E "a" ∖ "a"', '%const $E ["a"] ∖ "a"'],
];

function typeMatrix(legacy) {
  if (typeof legacy.grammar !== "string") return;
  let source = legacy.grammar.trimEnd();
  for (const [before, after] of matrixConstants) {
    if (!source.includes(before)) return;
    source = source.replace(before, after);
  }
  const lines = source.split("\n");
  const index = lines.findIndex(line => line.startsWith("%rule text $x:unit B %conditions "));
  if (index === -1) return;
  const host = "%rule text $x:unit B %conditions ";
  let expression = lines[index].slice(host.length)
    .replaceAll('($x ⟹ "a")', '[$x? "a"]')
    .replaceAll("($x ⟹ A)", "{$x? A}")
    .replaceAll('("a" "b")', '["a", "b"]')
    .replaceAll("(A B)", "{A, B}")
    .replaceAll("(A)", "({A})")
    .replaceAll("∅", "{}")
    .replaceAll("($x)", "($x.span)")
    .replaceAll("($)", "($.span)")
    .replace(/\$x\.(value|image)\b/g, (_, channel) => `$x.span.tokens!'${channel}.join()`);
  const method = /\.(?:parse|ngrams)\(/.exec(expression);
  const operator = / [=≠⊆⊈∈∉∪∩∖] /.exec(expression);
  if (!method && !operator) return;
  if (!method) {
    // In these cases the old scalar is implicitly a singleton string set.
    const symbol = operator[0].trim();
    if ("∈∉".includes(symbol)) expression = expression.replace(/([∈∉] )"a"$/, '$1["a"]');
    if ("⊆⊈∪∩∖".includes(symbol)) {
      expression = expression.replace(/^"a" /, '["a"] ').replace(/ "a"$/, ' ["a"]');
    }
  }
  const site = method ? method.index : /[=≠⊆⊈∈∉∪∩∖]/u.exec(expression).index;
  lines[index] = host + expression;
  return {
    source: ["%stage main", "%ambiguity-resolution greedy", ...lines],
    expected: { kind: "grammar", document: "main.md", line: index + 4, column: [...host, ...expression.slice(0, site)].length + 1 },
    section: method ? "Engine §10, Method signatures" : "Engine §10, Operators and truth",
    reason: method ? "Keep the nonmatching receiver and its original arguments." :
      "Keep the written operator and both incompatible operand types.",
  };
}

export function translateNegative49(id, legacy, description) {
  if (id.startsWith("engine/notation-r2-")) return typeMatrix(legacy);
  if (/^engine\/267-(?:capture-recipe|condition-|distinct-walks|item-|presence-|whole-recipe)/.test(id) &&
      description === "a method has the wrong receiver or arguments" &&
      [legacy.grammar, ...Object.values(legacy.documents ?? {})].some(text =>
        /%conditions[\s\S]*\.emitted\.(?:value|image)\b/.test(text ?? ""))) {
    return { retired: true, section: "Engine §§3.7, 10",
      reason: "The separate emitted receiver is gone. A condition reads a working key under the early demand rules." };
  }
}

const retiredFaults = [
  [/^a query method is a condition, not a term$/, "Engine §7, Queries",
    "The query method returns a forest value."],
  [/^a side of an implication /, "Engine §2, Classification",
    "The grammar gives each key at its supplier. The general implication declaration is gone."],
  [/ is not a class: a class starts and ends with a capital$/, "Engine §2, Classification",
    "A classifier table uses ordinary bag keys. A class name no longer needs a final capital."],
  [/^%emits of \S+ attaches \$\S+ in a production without its carrier /, "Engine §11.3",
    "Presentation follows a mandatory primary and its structural siblings. An emission item no longer names attachment lists."],
  [/^%emits of \S+ names \$\S+, an item capture, which only a condition reads$/,
    "Engine §11.1", "An emission item can forward an entire capture list."],
  [/^a clause of \S+ names \$\S+, an item capture, which only a condition reads$/,
    "Engine §§3.5, 10", "A clause can read an ordered list. Binding inside flat braces no longer limits reads to conditions."],
  [/^a condition of \S+ reads .*item captures of two pairs of braces$/, "Engine §§3.5–3.6",
    "The lists from distinct repetitions are ordinary operands. There is no implicit item frame whose owner must be inferred."],
  [/^a condition of \S+ reads .*an item capture, together with \$, which is not complete at each item$/,
    "Engine §§3.5–3.6", "An explicit list predicate can wait for the enclosing occurrence."],
  [/^a condition of \S+ reads .*with the item capture .*after the braces$/,
    "Engine §§3.5–3.6", "An explicit list predicate waits for its outer bindings. A later outer binding is legal."],
  [/^a recipe atom has no grouping or arguments$/, "Engine §10",
    "A string supplier is an expression. It can contain parentheses and method arguments."],
];

export function retireNegative49(description) {
  const fault = retiredFaults.find(([pattern]) => pattern.test(description));
  if (!fault) return;
  const [, section, reason] = fault;
  return { section, reason };
}
