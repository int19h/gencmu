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
  if (/\.ngrams\(\d+\) = \{\}$/.test(expression)) {
    // Equality with the old empty string set tests the list's length in format 50.
    expression = `¬(${expression.slice(0, -" = {}".length)})`;
  }
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

export function translateNegative49(id, legacy) {
  if (id.startsWith("engine/notation-r2-")) return typeMatrix(legacy);
}

const retiredFaults = [
  [/^a side of an implication /, "Engine §2, Classification",
    "The grammar gives each key at its supplier. The general implication declaration is gone."],
  [/^%emits of \S+ attaches \$\S+ in a production without its carrier /, "Engine §11.3",
    "Presentation follows a mandatory primary and its structural siblings. An emission item no longer names attachment lists."],
];

export function retireNegative49(description) {
  const fault = retiredFaults.find(([pattern]) => pattern.test(description));
  if (!fault) return;
  const [, section, reason] = fault;
  return { section, reason };
}
