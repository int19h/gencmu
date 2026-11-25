import assert from "node:assert/strict";
import { after, test } from "node:test";
import { methods50 } from "../src/format50/signatures.js";
import { createDifferential } from "../../../tools/transition/differential.js";

const fence = source => "\x60\x60\x60jbogenbau\n" + source + "\n\x60\x60\x60";
const preamble = "%stage s\n%rule matrix(@X) A\n%rule target A\n";
const text = "%rule text $n:A";
const truth = e => `[${e}].present`;
const string = e => `(${truth(e)} ? "yes" | "no")`;
// An empty list gives the binder an open element type. It lets the control
// write a method for a node or span without requiring an input stage.
const local = e => e.includes("$m") ? `[].all($m ↦ ${truth(e)})` : e;

const expressions = {
  constant: e => `%const $K ${e}`,
  "unused template condition": e => `%rule text(@X) A %conditions ${truth(e)}`,
  "replaced rule condition": e => `${text} %conditions ${truth(e)}\n%redefine-rule text A`,
  "rule condition": e => `${text} %conditions ${truth(e)}`,
  "rule term": e => `%rule text → {(${truth(e)})? Key}\n  | $n:A`,
  "alternative term": e => `${text} → {(${truth(e)})? Key}`,
  "nested bag value": e => `${text} → {k: {v: ${string(e)}}}`,
  "list item guard": e => `${text} %conditions [${truth(e)}? "yes"]`,
  "emission guard": e => `${text} %emit ${truth(e)}? $n`,
  "braced emission term": e => `${text} %emit $n{(${truth(e)})? Key}`,
  "insertion term": e => `${text} %emit ε{value: ${string(e)}, image: ""}`,
  "marked body argument": e => `%rule text matrix(= ${e})`,
  "marked pattern call argument": e => `%const $K #matrix(= ${e})`,
  "marked query call argument": e => `%rule text A %conditions $.parse(matrix(= ${e}))`,
  "marked ranking call argument": e => `%ambiguity-resolution most #·matrix(= ${e})`,
  "marked binding argument": e => `%rule text = matrix(= ${e})`,
  "marked exact edit argument": e => `%redefine-rule matrix(= ${e}) A`,
  "marked boundary target argument": e => `%rule text A %conditions $.followed-by(matrix(= ${e}))`,
  "marked family argument": e => `%rule text A %conditions $.without-elision-except(matrix(= ${e}))`,
  "feature condition": e => `%features enabled %conditions ${truth(e)}`,
  "error message": e => `${text} %error ${string(e)}`,
  "warning message": e => `${text} %warning ${string(e)}`,
  "method argument": e => `%const $K ["a", "b"].join(${string(e)})`,
  "map function": e => `%const $K [1]!($mapitem ↦ ${truth(e)})`,
  "predicate body": e => `%const $K [1].all($predicateitem ↦ ${truth(e)})`,
};

const bodies = {
  rule: b => `%rule text ${b}`,
  template: b => `%rule text(@X) ${b}`,
  "exact edit": b => `%redefine-rule matrix(T) ${b}`,
  "body argument": b => `%rule text matrix((${b}))`,
  "pattern call body argument": b => `%const $K #matrix((${b}))`,
  "body argument in query": b => `%rule text A %conditions $.parse(matrix((${b})))`,
  "ranking call body argument": b => `%ambiguity-resolution most #·matrix((${b}))`,
  "body argument in a binding": b => `%rule text = matrix((${b}))`,
  "body argument in an exact edit": b => `%redefine-rule matrix((${b})) A`,
  "body argument of a boundary target": b => `%rule text A %conditions $.followed-by(matrix((${b})))`,
  "body argument of a family": b => `%rule text A %conditions $.without-elision-except(matrix((${b})))`,
  "query body": b => `%rule text A %conditions $.parse(${b})`,
};

const unmarkedArguments = {
  "symbol in a body call": a => `%rule text matrix(${a})`,
  "symbol in a pattern call": a => `%const $K #matrix(${a})`,
  "symbol in a query call": a => `%rule text A %conditions $.parse(matrix(${a}))`,
  "symbol in a ranking call": a => `%ambiguity-resolution most #·matrix(${a})`,
  "symbol in a binding": a => `%rule text = matrix(${a})`,
  "symbol in an exact edit": a => `%redefine-rule matrix(${a}) A`,
  "symbol in a target call": a => `%rule text A %conditions $.followed-by(matrix(${a}))`,
  "symbol in a family call": a => `%rule text A %conditions $.without-elision-except(matrix(${a}))`,
};

const patterns = {
  ...Object.fromEntries(Object.entries(expressions).filter(([slot]) => slot !== "feature condition")
    .map(([slot, wrap]) => [slot, p => wrap(`#${p}`)])),
  "ranking step": p => `%ambiguity-resolution most #·${p}`,
};

const grammars = {
  expression: [expressions, "An expression must enter through an expression slot, such as a marked actual."],
  body: [bodies, "A body must enter through a body, unmarked actual or query slot."],
  argument: [unmarkedArguments, "An unmarked actual belongs to a call or exact-instance head."],
  pattern: [patterns, "A pattern must enter through a pattern expression or a ranking operand."],
  declaration: [{ "declaration or clause": source => source }, "The fault needs its owning declaration or clause."],
};
const noLocalRanking = "The ranking operand must be an exact local pattern with no child constraints or paths.";
const closedBody = "A closed argument or query body cannot contain captures, even in the control.";
const noFeatureMethod = "A feature condition cannot use this observation.";
const noMessageMethod = "A message cannot read a query or claim verbatim text.";
const noFeaturePattern = "A feature condition cannot use a pattern.";
const notInMatrix = [
  ["Malformed supplied DOMs and notation trees", "The missing fields, positions or raw constructors have no source input."],
  ["Unknown rule, constant or template; call arity or binding kind; constant cycles", "The effective definitions and their order can come from other stitched documents."],
  ["Unknown stage or rule edits; missing text, resolution or outputs", "These checks need a stitched pipeline or stage."],
  ["Missing suppliers, constant range or delimiter values, classifier references, substitution", "These checks need the supplier, its effective value or the bound argument."],
  ["Boundary reachability, brace and error-production nullability, overlap, comparison cycles", "These checks need the structural graph of the stitched stage."],
  ["Forbidden observations in feature conditions, feature order and dependencies", "These checks apply to surviving feature declarations of the stitched stage."],
  ["Warning suppression targets", "Explicit codes name warnings of a stitched stage."],
  ["Computed empty split delimiters", "Only literal and constant empty delimiters fail at load. Computed delimiters fail when evaluation reaches them."],
  ["Late recognition dependencies, unsupported reads and inferred number bounds", "These checks need the inference of suppliers and types for the stage."],
  ["Verbatim claim conflict and dynamic placement", "These checks need an input and the selected reading."],
];

const rows = [];
function add(group, entries) {
  for (const [name, fault, control, diagnostic, exceptions = {}, site] of entries) {
    rows.push({ group, name, fault, control, diagnostic, exceptions, site });
  }
}

// Engine §10, Method signatures. The suffix provides all written arguments.
// Each row crosses every expression host where the control can be written.
const nodeSelectors = [
  "span", "children", "without-elision", "without-elision-except(target)",
  "followed-by(A)", "preceded-by(A)", "tokens", "first-token", "last-token",
  "tokens-after-first", "onward", "following-tokens", "preceding-tokens",
  "starts-input", "ends-input", "source-text", "decomposed-source-text",
  "verbatim-text", "parse(A)",
];
const methods = [
  ...nodeSelectors.map(suffix => [suffix.split("(")[0], `1.${suffix}`, local(`$m.${suffix}`)]),
  ["error-free", "1.error-free", local("$m.parse(A).error-free")],
  ["present", "1.present", '["x"].present'],
  ...["flags", "classes", "keys", "has(A)", "has-value(A)", "select({A})", "overlaps({B})"].map(suffix =>
    [suffix.split("(")[0], `1.${suffix}`, `{A}.${suffix}`]),
  ["classify", '1.classify("a")', '{A: ["a"]}.classify("a")'],
  ["split", '1.split(",")', '"a".split(",")'],
  ["ngrams", "1.ngrams(1)", '"a".ngrams(1)'],
  ["at-most", '"x".at-most(1)', "1.at-most(1)"],
  ["all", '1.all($v ↦ [$v])', '["a"].all($v ↦ [$v])'],
  ["any", '1.any($v ↦ [$v])', '["a"].any($v ↦ [$v])'],
  ["join", "1.join()", '["a"].join()'],
  ["union", "1.union", "[{A}].union"],
];
const noFeature = new Set(["onward", "following-tokens", "preceding-tokens", "followed-by", "preceded-by",
  "without-elision", "without-elision-except", "verbatim-text", "parse", "error-free"]);

for (const [method, fault, control] of methods) {
  const exceptions = {};
  if (noFeature.has(method)) exceptions["feature condition"] = noFeatureMethod;
  if (["parse", "error-free", "verbatim-text"].includes(method)) {
    exceptions["error message"] = noMessageMethod;
    exceptions["warning message"] = noMessageMethod;
  }
  add("expression", [[`.${method} receiver`, fault, control, /wrong receiver or arguments/, exceptions]]);
}

const noFeaturePatterns = { "feature condition": noFeaturePattern };
add("expression", [
  ["unknown method", "1.unlisted-method", "1.at-most(1)", /unknown method/],
  ["nullary selector parentheses", "{A}.keys()", "{A}.keys", /omits parentheses/],
  ["unary selector parentheses", '["a"].join', '["a"].join()', /requires parentheses/],
  ["extra arguments", '["a"].join(",", ",")', '["a"].join(",")', /wrong number of arguments/],
  ["missing argument", '["a"].all()', '["a"].all($v ↦ [$v])', /wrong number of arguments/],
  ["list any requires a predicate", '["a"].any()', '["a"].any($v ↦ [$v])', /wrong receiver or arguments/],
  ["join member", '[1].join()', '["x"].join()', /wrong receiver or arguments/],
  ["union member", '[{A: "x"}].union', '[{A}].union', /wrong receiver or arguments/],
  ["join separator", '["a"].join(1)', '["a"].join(",")', /wrong receiver or arguments/],
  ["short classifier table", '[{A: 1}]!.classify("a")', '[{A: "a"}]!.classify("a")', /wrong receiver or arguments/],
  ["bare classifier entry", '{A}.classify("a")', '{A: "a"}.classify("a")', /wrong receiver or arguments/],
  ["invalid classifier member", '{A: [1]}.classify("a")', '{A: ["a"]}.classify("a")', /wrong receiver or arguments/],
  ["unbound classifier entry", '{A: {B}}.classify("a")', '{A: {B}, B: "a"}.classify("a")', /references unknown class B/],
  ["classify string", '{A: ["a"]}.classify(1)', '{A: ["a"]}.classify("a")', /wrong receiver or arguments/],
  ["select mask", '{A}.select({A: "x"})', '{A}.select({A})', /wrong receiver or arguments/],
  ["overlaps mask", '{A}.overlaps(1)', '{A}.overlaps({A})', /wrong receiver or arguments/],
  ["split argument", '"a".split(1)', '"a".split(",")', /wrong receiver or arguments/],
  ["split delimiter", '"a".split("")', '"a".split(",")', /delimiter cannot be empty/],
  ["width is positive", '"a".ngrams(0)', '"a".ngrams(256)', /width must be positive/],
  ["count literal", "256", "255", /count literal/],
  ["count cap", "1.at-most(256)", "1.at-most(255)", /count literal/],
  ["all argument", '[1].all((1 + 1))', '[1].all($v ↦ [$v])', /predicate requires an explicit binder|wrong receiver or arguments/],
  ["predicate result", '[1].all($v ↦ "x")', '[1].all($v ↦ [$v])', /does not have a truth value/],
  ["property receiver", "1'k", "{k: 1}'k", /property read needs a node or bag/],
  ["map list", '1!($v ↦ [$v])', '[1]!($v ↦ [$v])', /map needs a list/],
  ["short property receiver", "[1]!'k", "[{k: 1}]!'k", /property read needs a node or bag/],
  ["short method receiver", '[1]!.split(",")', '["x"]!.split(",")', /wrong receiver or arguments/],
  ["flatten item", "[1]↓", "[[1]]↓", /flatten needs a list of lists/],
  ["list splat", "[*1]", "[*[1]]", /list splat needs a list/],
  ["bag splat", "{*1}", "{*{K}}", /bag splat needs a bag or node/],
  ["list element types", '[1, "x"]', "[1, 2]", /one common element type/],
  ["list function", "[$v ↦ $v]", "[1]", /list cannot store a function/],
  ["function result", "[1]!($v ↦ $w ↦ $v)", "[1]!($v ↦ [$v])", /function cannot return a function/],
  ["shadowed local binder", "[1]!($v ↦ [2]!($v ↦ [$v]))", "[1]!($v ↦ [2]!($w ↦ [$v, $w]))", /binder cannot hide/],
  ["implicit item outside binder", "'k", "{k: 1}'k", /implicit receiver needs/, {
    "map function": "The map function already binds an item.",
    "predicate body": "The predicate already binds an item.",
  }],
  ["duplicate direct keys", "{K, K}", "{K, L}", /duplicate direct write/],
  ["duplicate chain key", "{enabled? k:k:1}", "{enabled? k:m:1}", /duplicate direct write/],
  ["copy receiver", "{1'k}", "{{k: 1}'k}", /copy needs a node or bag/],
  ["key stores truth", "{k: 1 = 1}", "{k: 1}", /needs a stored value/],
  ["key stores list of truth", "{k: [1 = 1]}", "{k: [1]}", /needs a stored value/],
  ["key stores pattern", "{k: #A}", "{k: 1}", /needs a stored value/, noFeaturePatterns],
  ["key stores function", "{k: $v ↦ $v}", "{k: [1]}", /key cannot store a function/],
  ["valued engine key", '{_White_Space: "x"}', '{K: "x"}', /cannot write an engine key/],
  ["origin as bag key", "{_Elided}", "{_White_Space}", /forbidden engine key/],
  ["origin in deletion", "{¬_Elided}", "{¬_White_Space}", /forbidden engine key/],
  ["origin in mask", "{K}.select({_Elided})", "{K}.select({K})", /forbidden engine key/],
  ["origin as property", "{K}'_Elided", "{K}'K", /forbidden engine key/],
  ["origin as presence key", "{K}.has(_Elided)", "{K}.has(K)", /forbidden engine key/],
  ["origin as payload presence key", "{K}.has-value(_Elided)", "{K}.has-value(K)", /forbidden engine key/],
  ["conditional branches", '(1 = 1 ? 1 | "x")', "(1 = 1 ? 1 | 2)", /compatible branch types/],
  ["string truth test", '¬"x"', "¬[1]", /does not have a truth value/],
  ["number truth test", "1 ∧ [1]", "[1] ∧ [1]", /does not have a truth value/],
  ["pattern truth test", "¬#A", "¬{}", /does not have a truth value/, noFeaturePatterns],
  ["function truth test", "¬($v ↦ $v)", "¬[1]", /does not have a truth value/],
  ["dead branch shape", '(1 = 1 ? 1 | "x" + 1)', "(1 = 1 ? 1 | 2 + 1)", /requires number operands/],
  ["property token class", "{K}'1", "{K}'k", /syntax stage could not continue/],
  ["unknown engine key", "{_Not_A_Unicode_Property}", "{K}", /unknown or forbidden engine key/],
  ["gated shape", '{enabled? k: "x" + 1}', "{enabled? k: 1 + 1}", /requires number operands/],
  ["conditional test", "(1 ? 1 | 2)", "([1] ? 1 | 2)", /does not have a truth value/],
  ["implication result", "[1] ⟹ 1", "[1] ⟹ [1]", /does not have a truth value/],
  ["noncomparable list membership", '#A ∈ [#A]', '"a" ∈ ["a"]', /requires compatible operands/, noFeaturePatterns],
  ["noncomparable list exclusion", '[#A] ∖ #A', '["a"] ∖ "a"', /requires compatible operands/, noFeaturePatterns],
  ["membership right operand", "1 ∈ {A}", "1 ∈ [1]", /requires a list on its right/],
  ["structural left form", "[1] ≅ #A", local("$m ≅ #A"), /one capture or bound item/, noFeaturePatterns],
  ["structural self comparison", local("$m ≅ $m"), local("$m ≅ #A"), /compare a binding with itself/, noFeaturePatterns],
  ["structural right type", local("$m ≅ 1"), local("$m ≅ #A"), /needs a pattern or a bound node/, noFeaturePatterns],
]);

for (const op of ["+", "<", "≤", ">", "≥", "=", "≠", "∪", "∩", "∖", "⊆", "⊈", "∈", "∉", "++"]) {
  const sets = "∪∩∖⊆⊈".includes(op);
  const membership = "∈∉".includes(op);
  const fault = sets ? `{A} ${op} "x"` : membership ? `1 ${op} ["x"]` : `1 ${op} "x"`;
  const control = sets ? `{A} ${op} {B}` : membership ? `1 ${op} [2]` :
    op === "++" ? '"a" ++ "b"' : `1 ${op} 2`;
  add("expression", [[`operator ${op}`, fault, control,
    /requires (?:compatible operands|key sets|number operands|comparable operands|string operands)/]]);
}

for (const method of ["followed-by", "preceded-by"]) {
  add("expression", [[`.${method} engine target`, local(`$m.${method}(_White_Space)`), local(`$m.${method}(A)`),
    /boundary target must be/, { "feature condition": noFeatureMethod }, `.${method}`]]);
}

// Selector grammar is separate from argument type. Some method forms
// cannot represent a missing argument record, so the source fails recognition.
const sourceArity = new Set(["any", "parse", "has", "has-value", "followed-by", "preceded-by",
  "without-elision-except", "ngrams", "at-most"]);
for (const [method, , control] of methods) {
  const { min, max } = methods50.get(method);
  const fault = max === 0 ? `1.${method}()` : min === 0 ? `1.${method}(1, 2)` : `1.${method}()`;
  const message = max === 0 ? /omits parentheses/ :
    sourceArity.has(method) ? /syntax stage could not continue/ : /wrong number of arguments/;
  const exceptions = {};
  if (noFeature.has(method)) exceptions["feature condition"] = noFeatureMethod;
  if (["parse", "error-free", "verbatim-text"].includes(method)) {
    exceptions["error message"] = noMessageMethod;
    exceptions["warning message"] = noMessageMethod;
  }
  add("expression", [[`.${method} arity`, fault, control, message, exceptions]]);
}

const boundaryHeader = '%rule probe(@P) A %conditions $.children.all(@P)\n';
for (const method of ["followed-by", "preceded-by"]) {
  for (const [name, source] of [
    ["direct condition", `%rule text $n:A %conditions $n.${method}(TARGET)`],
    ["pattern call", `%rule text $n:A %conditions $n ≅ #probe(= $m ↦ $m.${method}(TARGET))`],
    ["query", `%rule text A %conditions $.parse(probe(= $m ↦ $m.${method}(TARGET)))`],
    ["body call", `%rule text probe(= $m ↦ $m.${method}(TARGET))`],
    ["rule guard", `%rule text A → {$.${method}(TARGET)? K}`],
    ["chosen guard", `%rule text $n:A %emit $n.${method}(TARGET)? $n`],
    ["target choice", `%rule text $n:A %conditions $n.${method}(A | TARGET)`],
  ]) {
    add("declaration", [[`.${method} in a ${name}`, boundaryHeader + source.replace("TARGET", "_White_Space"),
      boundaryHeader + source.replace("TARGET", "B"), /boundary target must be/, {}, `.${method}`]]);
  }
}

const noCaptures = Object.fromEntries(Object.keys(bodies)
  .filter(slot => slot.includes("argument") || slot === "query body").map(slot => [slot, closedBody]));
const noChain = { "query body": "A chain cannot be a query target." };
add("body", [
  ["primary on only one route", "(^A | B)", "(^A | ^B)", /each route must have one primary/],
  ["two primaries", "^A ^B", "^A B", /more than one primary/],
  ["primary in optional", "[^A] B", "[A] ^B", /primary must mark a mandatory child/],
  ["primary in repetition", "{^A} B", "{A} ^B", /primary must mark a mandatory child/],
  ["primary in chain", "{... ^A / B}", "{... A / B}", /primary must mark a mandatory child/, noChain],
  ["primary in ranked option", "(^A ≻ B)", "(A ≻ B)", /primary must mark a mandatory child/],
  ["primary before splice", "^*target", "*target", /primary must mark a mandatory child/],
  ["primary before group", "^(A)", "^A", /ungrouped symbol or capture/],
  ["duplicate capture", "$x:A $x:B", "$x:A $y:B", /binds \$x twice/, noCaptures],
  ["capture before a group", "$x:(A)", "$x:A", /capture .*one (?:ungrouped )?symbol/, noCaptures],
  ["capture before brackets", "$x:[A]", "$x:A", /capture .*one (?:ungrouped )?symbol/, noCaptures],
  ["capture before braces", "$x:{A}", "$x:A", /capture .*one (?:ungrouped )?symbol/, noCaptures],
  ["chain capture", "{... $x:A / B}", "{... A / B}", /chain item or separator cannot bind/, noCaptures],
  ["chain inside a sequence", "A {... B / C}", "A {B / C}", /chain must occupy a whole alternative|a chain cannot be the query target/],
  ["chain marker in separator", "{A / ... B}", "{A / B}", /chain marker.*separator|separator.*chain marker/],
  ["double chain marker", "{... A ... / B}", "{A / B}", /chain can have only one marker/],
  ["max subset length", Array(17).fill("A").join(" & "), Array(16).fill("A").join(" & "), /sixteen|16/],
  ["default outside omission", 'A≝"d"', '[+A≝"d"]', /only an elidable head/],
  ["omission predicate", '[+A="a"≝"b"]', '[+A="a"≝"a"]', /omission.*(?:test|predicate)|default.*satisf/],
  ["duplicate elision marker", "[++A]", "[+A]", /once|one mark|syntax stage/],
  ["elidable grouped head", "[+(A)]", "[+A]", /ungrouped user terminal/],
  ["elidable engine terminal", "[+_White_Space]", "[+A]", /ungrouped user terminal/],
  ["short range endpoint", '"".."z"', '"a".."z"', /one scalar/],
  ["long range endpoint", '"ab".."z"', '"a".."z"', /one scalar/],
  ["reversed scalar range", '"z".."a"', '"a".."z"', /range starts above its end/],
  ["repeated filter", "A<K><L>", "A<K L>", /once in that order/],
  ["reversed tests", 'A="x"<K>', 'A<K>="x"', /once in that order/],
  ["grouped test target", "(A)<K>", "A<K>", /test needs one ungrouped symbol|test.*one symbol/],
  ["inline concatenation in test", 'A="a" ++ "b"', 'A="ab"', /syntax stage could not continue/],
  ["inline concatenation in range", '"a" ++ "b".."z"', '"a".."z"', /syntax stage could not continue/],
  ["grouped value operand", 'A=("x")', 'A="x"', /a string operand needs a literal, constant or parameter/],
  ["positive rule origin", "target<_Elided>", "target<K>", /origin test applies only/],
  ["negative rule origin", "target<¬_Elided>", "target<¬K>", /origin test applies only/],
  ["call origin", "matrix(A)<¬_Elided>", "matrix(A)<¬K>", /origin test applies only/],
  ["splice origin", "*target<¬_Elided>", "*target<¬K>", /origin test applies only/],
]);

const unmarkedFaults = new Set(["short range endpoint", "long range endpoint", "reversed scalar range",
  "repeated filter", "reversed tests", "grouped value operand", "positive rule origin", "negative rule origin",
  "call origin", "splice origin"]);
for (const record of rows.filter(r => r.group === "body" && unmarkedFaults.has(r.name))) {
  rows.push({ ...record, group: "argument", exceptions: {} });
}
add("argument", [
  ["unknown requirement key", "<_Not_A_Unicode_Property>", "<A>", /unknown or forbidden engine key/],
  ["unknown target key", "A | _Not_A_Unicode_Property", "A | B", /unknown or forbidden engine key/],
]);

const noChildRanking = { "ranking step": noLocalRanking };
add("pattern", [
  ["rule pattern origin", "target<_Elided>", "target<¬_Elided>", /origin test applies only/],
  ["call pattern origin", "matrix(A)<_Elided>", "matrix(A)<¬_Elided>", /origin test applies only/],
  ["literal range endpoint", '"ab".."z"', '"a".."z"', /one scalar/],
  ["inline concatenation in pattern range", '("a" ++ "b".."z")', '("a".."z")', /syntax stage could not continue/,
    { "ranking step": "An exact prefix modifies an atom. The grouped operands in this pair fit a pattern expression." }],
  ["reversed pattern range", '"z".."a"', '"a".."z"', /range/],
  ["terminal child list", "A⁅ B ⁆", "target⁅ B ⁆", /only an untested rule atom, call or parameter can have a child list/, noChildRanking],
  ["gap in child repeat", "target⁅ {A ⋯} ⁆", "target⁅ {A B} ⁆", /repeated child list cannot contain a sibling gap/, noChildRanking],
  ["path takes whole pattern", "target⁅ ⋮(A B) ⁆", "target⁅ ⋮A ⁆", /whole pattern|one pattern/, noChildRanking],
]);

// A clause or declaration fault needs both the operand and its owner.
add("declaration", [
  ["named boundary capture", "%rule text $n:A $x:B %conditions $n.followed-by(A) ∧ $x", "%rule text $n:A $x:B %conditions $n.followed-by(A) ∧ $n", /cannot read another capture/],
  ["two boundary atoms", "%rule text $n:A %conditions $n.followed-by(A) ∧ $n.preceded-by(A)", "%rule text $n:A %conditions $n.followed-by(A), $n.preceded-by(A)", /more than one boundary atom/],
  ["condition applies to no expansion", "%rule text $n:A | $x:B %conditions $n.has(K) = $x.has(K)", "%rule text $n:A | $x:B %conditions $n ⟹ $n.has(K)", /condition.*no (?:alternative|expansion)|cannot apply/],
  ["unknown capture condition", `${text} %conditions $missing`, `${text} %conditions $n`, /captured by no alternative/],
  ["unknown capture term", `${text} → {$missing? K}`, `${text} → {$n? K}`, /captured by no alternative/],
  ["unknown capture message", `${text} %error ($missing ? "full" | "empty")`, `${text} %error ($n ? "full" | "empty")`, /captured by no alternative/],
  ["unknown capture output", `${text} %emit $missing`, `${text} %emit $n`, /captured by no alternative/],
  ["missing capture on a term route", "%rule text → {*$n.flags} | $n:A | B", "%rule text → {$n? *$n.flags} | $n:A | B", /absent from this expansion/],
  ["missing capture on a message route", '%rule text $n:A | B %error $n.source-text', '%rule text $n:A | B %error ($n ? $n.source-text | "none")', /absent from this expansion/],
  ["key stores a node", `${text} → {k: $n}`, `${text} → {k: "n"}`, /needs a stored value/],
  ["key stores a span", `${text} → {k: $n.span}`, `${text} → {k: $n.source-text}`, /needs a stored value/],
  ["key stores a forest", `${text} → {k: $n.parse(A)}`, `${text} → {k: $n.source-text}`, /needs a stored value/],
  ["unknown parameter in a body", "%rule text(@X) @Y", "%rule text(@X) @X", /unknown parameter @Y/],
  ["unknown parameter in a marked actual", "%rule text(@X) matrix(= @Y)", "%rule text(@X) matrix(= @X)", /unknown parameter @Y/],
  ["unknown parameter in a pattern", "%rule text(@X) A %conditions $ ≅ #@Y", "%rule text(@X) A %conditions $ ≅ #@X", /unknown parameter @Y/],
  ["unknown parameter in a requirement", "%rule text(@X) A<@Y>", "%rule text(@X) A<@X>", /unknown parameter @Y/],
  ["unknown parameter in a query", "%rule text(@X) A %conditions $.parse(@Y)", "%rule text(@X) A %conditions $.parse(@X)", /unknown parameter @Y/],
  ["unknown parameter in a family", "%rule text(@X) A %conditions $.without-elision-except(@Y)", "%rule text(@X) A %conditions $.without-elision-except(@X)", /unknown parameter @Y/],
  ["message claims verbatim text", `${text} %error $n.verbatim-text`, `${text} %error $n.source-text`, /message cannot claim verbatim text/],
  ["named feature capture", "%features enabled %conditions $n", "%features enabled %conditions $", /feature condition cannot read a named capture/],
  ...Object.entries(expressions).filter(([slot]) => slot.startsWith("marked ")).map(([slot, wrap]) =>
    [`capture read in ${slot}`, wrap("$n"), wrap('"n"'), /argument cannot read or declare captures/]),
  ["closed pattern call capture read", "%rule text A %conditions $ ≅ #matrix(= $)", '%rule text A %conditions $ ≅ #matrix(= "n")', /argument cannot read or declare captures/],
  ...Object.entries(bodies).filter(([slot]) => slot.includes("argument")).map(([slot, wrap]) =>
    [`capture declaration in ${slot}`, wrap("$n:A B"), wrap("A B"), /argument cannot read or declare captures/]),
  ["query capture declaration", "%rule text A %conditions $.parse($n:A)", "%rule text A %conditions $.parse(A)", /query cannot declare captures/],
  ["query chain", "%rule text A %conditions $.parse({... A / B})", "%rule text A %conditions $.parse({A / B})", /chain.*query/],
  ["message type", `${text} %error 1`, `${text} %error "one"`, /message needs a string/],
  ["message query", `${text} %warning ($.parse(A) ? "one" | "two")`, `${text} %warning ($ ? "one" | "two")`, /message cannot read a query/],
  ["braced list output", "%rule text {$x:A} %emit $x{K}", "%rule text {$x:A} %emit $x", /braced output item needs a node/],
  ["bare whole-rule output", `${text} %emit $`, `${text} %emit ${"$"}{K}`, /only a braced item/],
  ["erasure with emission", `${text} %emit $n %erased`, `${text} %emit $n`, /erase|syntax/],
  ["node string field", `${text} → {value: 1}`, `${text} → {value: "one"}`, /value or image needs a string/],
  ["emission string field", `${text} %emit $n{image: 1}`, `${text} %emit $n{image: "one"}`, /value or image needs a string/],
  ["node bare engine key", `${text} → {_White_Space}`, `${text} → {K}`, /engine key without provenance/],
  ["invalid warning code", `${text} %suppress-warnings bad_code`, `${text} %suppress-warnings ok`, /invalid warning code/],
  ["template error", '%rule text(@X) @X %error "bad"', "%rule text(@X) @X", /template cannot declare/],
  ["template warning", '%rule text(@X) @X %warning "warn"', "%rule text(@X) @X", /template cannot declare/],
  ["duplicate formal", "%rule text(@X, @X) @X", "%rule text(@X, @Y) @X", /duplicate parameter/],
  ["mixed head", "%redefine-rule text(@X, A) A", "%redefine-rule text(B, A) A", /all parameters or an exact instance edit/],
  ["binding with a call head", "%rule text(A) = matrix(A)", "%rule text = matrix(A)", /binding needs a plain rule name/],
  ["reserved constant edit", "%redefine-const $INPUTS {}", "%redefine-const $K {}", /supplied by the engine/],
  ["reserved constant", "%const $INPUTS {}", "%const $K {}", /supplied by the engine/],
  ["empty resolution", "%ambiguity-resolution", "%ambiguity-resolution greedy", /resolution policy|syntax/],
  ["ranking missing exact", "%ambiguity-resolution most #target", "%ambiguity-resolution most #·target", /exact local pattern/],
  ["ranking child list", "%ambiguity-resolution most #·target⁅ A ⁆", "%ambiguity-resolution most #·target", /exact local pattern/],
  ["ranking positive origin", "%ambiguity-resolution leftmost-longest #·A<_Elided>", "%ambiguity-resolution leftmost-longest #·A<¬_Elided>", /cannot require _Elided/],
  ["stage operand", '%stage "s"', "%stage t", /takes one stage name/],
  ["stage name missing", "%stage", "%stage t", /takes one stage name/],
  ["extend stage operand", '%extend-stage "s"', "%extend-stage s", /takes one stage name/],
  ["redefine stage operand", '%redefine-stage "s"', "%redefine-stage s", /takes one stage name/],
  ["feature operand", "%features", "%features enabled", /takes feature names/],
  ["include arity", "%include", '%include "grammar.md"', /takes one quoted path/],
  ["names arity", "%names", "", /takes one quoted path/],
  ["names after a rule", '%names "names.txt"', "", /must precede all other declarations/],
  ["resolution lean takes no pattern", "%ambiguity-resolution greedy #·A", "%ambiguity-resolution greedy", /invalid resolution step operand/],
  ["resolution key requires a pattern", "%ambiguity-resolution most", "%ambiguity-resolution most #·A", /invalid resolution step operand/],
  ["resolution lean must be last", "%ambiguity-resolution greedy, most #·A", "%ambiguity-resolution most #·A, greedy", /invalid resolution policy/],
  ["elision-only operand", "%elision-only A", "%elision-only", /takes no operands/],
]);

add("declaration", [
  ["expression depth", expressions.constant("[".repeat(257) + '""' + "]".repeat(257)),
    expressions.constant("[".repeat(256) + '""' + "]".repeat(256)), /nested more than 256 deep/],
  ["pattern depth", patterns.constant("target⁅ ".repeat(130) + "A" + " ⁆".repeat(130)),
    patterns.constant("target⁅ A ⁆"), /nested more than 256 deep/],
  ["body depth", bodies.rule("[".repeat(257) + "A" + "]".repeat(257)),
    bodies.rule("[".repeat(256) + "A" + "]".repeat(256)), /nested more than 256 deep/],
]);
const differential = createDifferential();
const compiler = differential.compiler();
const pairs = [];
const counts = { rows: rows.length, pairs: 0, impossible: 0 };
function read(source) {
  return compiler.compileDocument(fence(source), "matrix.md");
}

for (const row of rows) {
  for (const [group, [hosts, reason]] of Object.entries(grammars)) {
    for (const [slot, wrap] of Object.entries(hosts)) {
      const unavailable = group === row.group ? row.exceptions[slot] : reason;
      if (unavailable) counts.impossible++;
      else pairs.push({ ...row, slot, wrap });
    }
  }
}
counts.pairs = pairs.length;

test("context matrix accounts for method signatures and source slots", () => {
  assert.deepEqual(methods.map(([method]) => method).sort(), [...methods50.keys()].sort());
  for (const row of rows) {
    const hosts = grammars[row.group][0];
    for (const [name, reason] of Object.entries(row.exceptions)) {
      assert.ok(Object.hasOwn(hosts, name) && reason.length > 0, name);
    }
  }
  assert.ok(notInMatrix.every(([, reason]) => reason.length > 0));
  assert.equal(counts.pairs + counts.impossible,
    rows.length * Object.values(grammars).reduce((sum, [hosts]) => sum + Object.keys(hosts).length, 0));
});
after(() => differential.finish("context matrix inputs", counts));

for (const { group, slot, name, wrap, fault, control, diagnostic, site } of pairs) {
  test(`context matrix ${group} / ${slot} / ${name}`, () => {
    const prefix = name === "names arity" ? "" : preamble;
    const valid = prefix + wrap(control);
    const invalid = prefix + wrap(fault);
    assert.ok(read(valid), valid);
    assert.throws(() => read(invalid), error => {
      assert.equal(error.kind, "grammar", invalid);
      assert.match(error.description, diagnostic, invalid + "\n" + error.description);
      if (site) {
        const lines = invalid.split("\n");
        const index = lines.findIndex(line => line.includes(site));
        assert.equal(error.where.line, index + 2);
        assert.equal(error.where.column, lines[index].lastIndexOf(site) + 1);
      }
      return true;
    }, invalid);
  });
}
