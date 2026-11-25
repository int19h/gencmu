import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { createDifferential } from "./differential.js";
import { createTransitionCompiler } from "../transition-compiler.js";
import { validateDefinitionNullability50, validateDocument50 } from "../../lib/js/src/format50/validate.js";

const createObserved = observeDocument => createTransitionCompiler(undefined, { observeDocument });
const differential = createDifferential();
after(() => differential.finish("validation inputs"));
const compiler = differential.compiler();
const fenced = source => "\x60\x60\x60jbogenbau\n" + source + "\n\x60\x60\x60";
const read = source => compiler.compileDocument(fenced(source), "probe.md");

for (const source of [
  '%const $K (1 = 1 ? {A} | {a: 1})',
  '%const $K (1 = 1 ? {} | {a: "x"})',
  '%const $K [{}, {a: 1}]',
  '%const $X [["a"]] ∖ ["a"]',
  '%const $X [["a"], ["b"]] ∖ ["a"]',
  '%rule r\n  | $x:"a"\n  | "b" → {k: ["a"].all($x ↦ $x = "a")}',
  '%rule r $x:"a"\n%conditions $x.followed-by(r) ∧ ["a"].all($y ↦ $y = "a")',
  '%rule r → {value: 1}\n  | "a" → {value: "ok"}',
  '%rule r → {image: 1}\n  | "a" → {¬image}',
  '%rule 😀 "a"',
  '%rule r $x:"a"\n%conditions $x\'_White_Space',
]) {
  test(`valid document ${source}`, () => {
    const dom = read("%stage s\n" + source);
    assert.equal(validateDocument50(dom), dom);
    assert.equal(validateDocument50(dom, { unicode: compiler.unicode }), dom);
  });
}

test("requirement and target actuals have transparent wrappers at the depth limit", () => {
  const calls = [
    { tag: "A" }, { expression: { string: "a" } },
    { requirements: [{ negated: false, value: { tag: "T" } }] },
    { targets: [{ rule: "a" }, { rule: "b" }] },
  ];
  for (const arg of calls) {
    const dom = read("%rule r f(A)");
    const alt = dom.rules[0].alternatives[0];
    let body = { call: "f", args: [{ ...arg, at: [2, 11] }], at: [2, 9] };
    for (let depth = 0; depth < 255; depth++) body = { seq: [{ ref: "A" }, body] };
    alt.expr = body;
    assert.equal(validateDocument50(dom), dom);
    alt.expr = { seq: [{ ref: "A" }, body] };
    assert.throws(() => validateDocument50(dom), /nested more than 256 deep/);
  }
});

for (const [source, anchor] of [
  ['%rule r\n  | [$b:"b"] → {$b? *$c.flags}\n  | $c:"c"', ".flags"],
  ['%rule r\n  | $b:"b" → {(1 = 1)? *$c.flags}\n  | $c:"c"', ".flags"],
  ['%rule r\n  | $b:"b" → {k: ($b\'F ? $c\'v | "x")}\n  | $c:"c"', "'v"],
  ['%rule r\n  | [$b:"b"]\n  | $c:"c"\n%error ($b ? $c\'v | "x")', "'v"],
  ['%rule r → {($b ∧ $c\'F)? K}\n  | [$b:"b"]\n  | $c:"c"', "'F"],
  ['%rule r\n  | $b:"b"\n  | $c:"c"\n%emit (1 = 1)? ${*$c.flags}', ".flags"],
]) {
  test(`missing capture behind a guard in ${source}`, () => {
    const lines = source.split("\n");
    const index = lines.findIndex(line => line.includes(anchor));
    assert.throws(() => read("%stage s\n" + source), error => {
      assert.equal(error.description, "$c is absent from this expansion");
      assert.deepEqual(error.where, { document: "probe.md", line: index + 3, column: lines[index].indexOf(anchor) + 1 });
      return true;
    });
  });
}

for (const [source, message, column] of [
  ["%rule r A %conditions $.keys()", /omits parentheses/, 24],
  ['%const $A ["x"].join', /requires parentheses/, 16],
  ["%const $N $x ↦ {($x'key)}", /copy ends with a property selector/, 17],
  ["%const $N $row ↦ [1].all($)", /predicate requires an explicit binder/],
  ["%const $N $row ↦ [1].all(($row))", /predicate requires an explicit binder/],
  ["%const $N $row ↦ [1]!($)", /predicate requires an explicit binder/],
  ["%const $N $row ↦ [1]!.join", /requires parentheses/],
  ["%rule r A %conditions $.value", /unknown method .value/],
  ...["[+(T)]", "[+|T]", "[+&T]", "[+(T A)]", "[+$x:T]", "[+T $x:A]"].map(body =>
    ["%rule r " + body, /ungrouped user terminal/]),
  ...["^(T)", "^($x:A)"].map(body =>
    ["%rule r " + body, /ungrouped symbol or capture/]),
  ...["^*sub", "^$x:*sub"].map(body =>
    ["%rule r " + body, /primary must mark a mandatory child/, 1]),
  ["%rule r ^A ^B", /more than one primary/],
  ["%rule r (^A | B)", /each route must have one primary/],
  ["%rule r [^A]", /primary must mark a mandatory child/],
  ["%rule r { ... $a:A / $b:B }", /chain item or separator cannot bind/],
  ["%rule r [$x:A] $x:B", /binds \$x twice/, 1],
  ["%rule r f(= $.span)", /argument cannot read or declare captures/],
  ["%rule r f(= $x ↦ [1]!($x ↦ $x))", /cannot hide a live name/],
  ["%const $K {K,K}", /duplicate direct write/, 14],
  ["%rule r ^A → {k:1,k:2}", /duplicate direct write/, 19],
  ["%const $K $x ↦ {k,$x'k}", /duplicate direct write/],
  ["%const $K {f? k:k:1}", /duplicate direct write/],
  ["%const $N 256", /count literal/, 1],
  ["%rule r A %conditions $.at-most(256)", /count literal/],
  ["%const $INPUTS {}", /supplied by the engine/],
  ["%redefine-const $INPUTS {}", /supplied by the engine/],
  ["%ambiguity-resolution most #r", /exact local pattern/, 29],
  ["%rule r T %suppress-warnings a_b", /invalid warning code/],
  ["%rule r _Bogus<A><B>", /once in that order/, 18],
  ["%rule f(A) = g(A)", /plain rule name/, 7],
  ['%const $K {K,K}\n%rule f(A) = g(A)', /duplicate direct write/],
  ["%rule r $x:A %conditions $x ≅ $x", /compare a binding with itself/],
  ["%rule r A %conditions $.followed-by(_White_Space)", /boundary target must be/],
  ["%rule r $x:A %conditions $x.span.tokens.all($x ↦ $x'B)", /cannot hide a live name/],
  ["%rule r {$a:A} %conditions $a.all($n ↦ $a.any($n ↦ $n'B))", /cannot hide a live name/],
  ["%rule r [$x:A] B %conditions $x ⟹ $x.onward.parse(A …)", /wrong receiver or arguments/],
  ['%rule r {$x:A} %conditions $x\'value = "a"', /a property read needs a node or bag/],
  ["%rule r {$x:A} %emit $x{K}", /a braced output item needs a node/],
  ['%rule r A %conditions "x"', /does not have a truth value/, 1],
  ["%rule r A %conditions ¬1", /does not have a truth value/, 23],
  ['%const $K (1 = 1 ? "a" | 2)', /conditional requires compatible branch types/],
  ["%const $K {a: $x ↦ $x}", /a key cannot store a function/],
  ['%rule r A → {_White_Space: "x"}', /a constructor cannot write an engine key/],
  ["%features f %conditions $x'A", /a feature condition cannot read a named capture/],
  ['%rule r → {*$a.flags}\n  | $b:"b"\n  | $a:"a"', /\$a is absent from this expansion/, 15],
  ['%rule r A %conditions "x" ∧ ("a" = 1)', /does not have a truth value/, 27],
]) {
  test(source, () => assert.throws(() => read(source), error =>
    error.kind === "grammar" && message.test(error.description) &&
      (column === undefined || error.where.column === column), message.source));
}

test("grouped arguments keep the terminal or rule class of the symbol", () => {
  const { rules } = read("%rule t(@X) @X\n%rule r t((A)) t((a)) t(A) t((_White_Space))\n%rule a B");
  const args = rules[1].alternatives[0].expr.seq.map(call => call.args[0]);
  assert.deepEqual(args.map(({ at, ...symbol }) => symbol), [
    { tag: "A" }, { rule: "a" }, { tag: "A" }, { tag: "_White_Space" },
  ]);
});

test("a parameter atom defers both forms of the origin test to substitution", () => {
  for (const sign of ["", "¬"]) {
    const dom = read(`%rule f(@T) $x:@T\n%conditions $x ≅ #@T<${sign}_Elided>`);
    const { pattern } = dom.rules[0].conditions[0].right;
    assert.equal(pattern.expr.param, "T");
    assert.equal(pattern.requirements[0].negated, sign === "¬");
  }
  assert.throws(() => read("%rule f $x:A\n%conditions $x ≅ #f<_Elided>"), /origin test applies only to a terminal/);
});

test("a DOM fault in a capture read uses its selector in both readers", () => {
  const source = "%rule r $b:A → {*$b.flags}";
  const dom = read(source);
  const value = dom.rules[0].alternatives[0].term.bag[0].value;
  value.receiver.capture = "a";
  const expected = { document: "probe.md", line: value.at[0], column: value.at[1] };
  const matches = error => {
    assert.match(error.description, /\$a is captured by no alternative/);
    assert.deepEqual(error.where, expected);
    return true;
  };
  assert.throws(() => read(source.replace("$b.flags", "$a.flags")), matches);
  assert.throws(() => validateDocument50(dom, { document: "probe.md", unicode: compiler.unicode }), matches);
});

test("a reserved key argument uses the method position in both readers", () => {
  for (const method of ["has", "has-value"]) {
    const source = `%rule r A\n%conditions $.${method}(key)`;
    const dom = read(source);
    const [condition] = dom.rules[0].conditions;
    condition.args[0].key = "_Elided";
    const matches = error => {
      assert.match(error.description, /unknown or forbidden engine key _Elided/);
      assert.deepEqual(error.where, { document: "probe.md", line: condition.at[0], column: condition.at[1] });
      return true;
    };
    assert.throws(() => read(source.replace("key", "_Elided")), matches);
    assert.throws(() => validateDocument50(dom, { document: "probe.md", unicode: compiler.unicode }), matches);
  }
});

test("stored declarations receive the same shape checks as source declarations", () => {
  const dom = read("%rule r $x:A");
  const directive = (name, args) => ({ name, args, at: [2, 1] });
  const cases = [
    [directive("names", ["names.txt"]), /must precede all other declarations/],
    [directive("stage", ["a", "b"]), /takes one stage name/],
    [directive("include", []), /takes one quoted path/],
    [directive("features", ["_f"]), /takes feature names/],
    [directive("elision-only", ["x"]), /takes no operands/],
    [{ name: "ambiguity-resolution", steps: [{ step: "most" }], at: [2, 1] }, /invalid resolution step operand/],
    [{ name: "ambiguity-resolution", steps: [{ step: "greedy" }, { step: "lazy" }], at: [2, 1] }, /invalid resolution policy/],
  ];
  for (const [record, description] of cases) {
    const invalid = { ...dom, directives: [{ ...record, at: [3, 1] }] };
    assert.throws(() => validateDocument50(invalid, { unicode: compiler.unicode }), description);
  }
});

test("the first expansion checks its rule term before its alternative term", () => {
  const source = '%rule r → {*$a.flags}\n  | $b:"b" → {*$c.flags}\n  | $a:"a"\n  | $c:"c"';
  assert.throws(() => read(source), error => {
    assert.equal(error.description, "$a is absent from this expansion");
    assert.deepEqual(error.where, { document: "probe.md", line: 2, column: 15 });
    return true;
  });
});

test("nullability uses the first expanded production with an error source", () => {
  const warning = { at: [2, 1] };
  const first = { at: [3, 1] };
  const second = { at: [7, 1] };
  const productions = [
    { warning, empty: true },
    { errorSource: second, empty: false },
    { errorSource: first, empty: true },
    { errorSource: second, empty: true },
  ];
  const fault = {};
  assert.throws(() => validateDefinitionNullability50(productions, production => production.empty, (record, description) => {
    assert.equal(record, first);
    assert.match(description, /error production can derive an empty sequence/);
    throw fault;
  }), error => error === fault);
});

test("an explicit function actual can read its own parameter", () => {
  const actual = read("%rule r f(= [1] !($n ↦ $n + 1))").rules[0].alternatives[0].expr.args[0];
  assert.deepEqual(actual.at, [2, 13]);
  assert.deepEqual(actual.expression.by, {
    lambda: "n", body: { op: "+", left: { capture: "n" }, right: { integer: "1" }, at: [2, 27] }, at: [2, 19],
  });
  assert.doesNotThrow(() => read("%rule r A %conditions $.parse(f(= [1] !($n ↦ $n + 1)))"));
});

test("an elidable head keeps its filter, value, and default when omission passes", () => {
  const { optional, elidable, default: value } = read('%rule r [+T<T>="t"≝"t" B]').rules[0].alternatives[0].expr;
  assert.equal(elidable, true);
  assert.deepEqual(value, { string: "t" });
  assert.equal(optional.seq[0].expr.requirements[0].value.tag, "T");
  assert.deepEqual(optional.seq[0].value, { string: "t" });
  assert.throws(() => read('%rule r [+T<A>="t"≝"t" B]'), /default does not pass the omission predicate/);
});

test("an n-gram width has no count bound", () =>
  assert.equal(read('%const $N "a".ngrams(12345678901234567890123456789)').constants[0].value.args[0].integer,
    "12345678901234567890123456789"));

test("terminal classification in origin tests survives a custom emoji table", () => {
  const core = "unicode 15.1.0\nwhite-space 0009 000D\nwhite-space 0020 0020\nemoji-presentation 0041 0041\n";
  const custom = differential.compiler(file => file === "data/unicode/unicode.txt" ? core : undefined);
  for (const [text, negated] of [["A<_Elided>", false], ["A<¬_Elided>", true]]) {
    const { expr } = custom.compileDocument(fenced("%rule text " + text)).rules[0].alternatives[0];
    assert.deepEqual(expr.requirements, [{ negated, value: { tag: "_Elided" } }]);
    assert.deepEqual(expr.expr, { ref: "A" });
  }
});

test("explicit Unicode resources depend on presence, including identical bytes", () => {
  const core = "data/unicode/unicode.txt";
  const properties = "data/unicode/unicode-properties.txt";
  const resource = file => fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8");
  const bundledCore = resource(core);
  const bundledProperties = resource(properties);
  const supplied = differential.compiler(file => file === core ? bundledCore + "\n" :
    file === properties ? bundledProperties : undefined);
  assert.deepEqual(supplied.compileDocument(fenced("%rule text _Alphabetic")).rules[0].alternatives[0].expr,
    { ref: "_Alphabetic" });
  const coreOnly = differential.compiler(file => file === core ? bundledCore : undefined);
  assert.throws(() => coreOnly.compileDocument(fenced("%rule text _Alphabetic")), /unknown or forbidden engine key/);
});

function assertFault(action, description, line, column) {
  assert.throws(action, error => {
    assert.equal(error.kind, "grammar");
    assert.match(error.description, description);
    assert.equal(error.where.line, line);
    assert.equal(error.where.column, column);
    return true;
  });
}

for (const [body, description, line, anchor] of [
  ['%rule r → {k: "a" = 1}\n  | "a"\n%conditions "x"', /comparable operands/, 3, "= 1"],
  ['%rule r\n  | $a:"a"\n  | "b" → {*$a.flags}\n%conditions "x"', /\$a is absent/, 5, ".flags"],
  ['%rule r "a"\n%conditions $.followed-by(_White_Space) ∧ ("a" = 1)', /boundary target must be/, 4, ".followed-by"],
  ['%rule r → {k:k:1}\n  | ^"a" ^"b"', /duplicate direct write/, 3, "k:k"],
]) {
  test(`reader chooses its first written fault in ${body}`, () => {
    const source = "%stage s\n" + body;
    const column = source.split("\n")[line - 2].indexOf(anchor) + 1;
    assertFault(() => read(source), description, line, column);
    if (anchor !== "k:k") return;
    const dom = read('%stage s\n%rule r → {k:1}\n  | ^"a" "b"');
    const rule = dom.rules[0];
    rule.term.bag[0].keys.push("k");
    const { seq } = rule.alternatives[0].expr;
    seq[1] = { primary: seq[1] };
    assertFault(() => validateDocument50(dom), description, line, column);
  });
}

const shape = ['%const $SHAPE {k:k:1}', /duplicate direct write/, "k:k"];
const delimiter = ['%const $DELIMITER "a".split("")', /delimiter cannot be empty/, ".split"];
const name = ['%rule named "r" %conditions $missing', /captured by no alternative/, "%rule"];
const types = ['%const $TYPES "a" + 1', /requires number operands/, "+ 1"];
const boundary = ['%rule boundary "a" %conditions $.followed-by(_White_Space)', /boundary target must be/, ".followed-by"];
const depth = ['%const $DEPTH ' + "[".repeat(257) + '""' + "]".repeat(257), /nested more than 256 deep/, "%const"];
const native = [
  ['%extend-rule missing "a"', "stitching"],
  ['%rule empty ε %error "empty"', "nullability"],
  ['%const $OUTPUTS {}\n%rule overlap $a:a $b:b %emit $b, $a\n%rule a "a" %emit\n%rule b "b" %emit', "overlap"],
];
const writtenOperands = [name, types, boundary];
const steps = [shape, delimiter, ...writtenOperands, depth];

for (const [index, earlier] of steps.entries()) {
  for (const later of [...steps.slice(index + 1), ...native]) {
    const [source, description, anchor] = earlier;
    // Names and other operands share written order across declarations.
    const first = writtenOperands.includes(earlier) && writtenOperands.includes(later) ?
      source + "\n" + later[0] : later[0] + "\n" + source;
    const line = first.split("\n").findIndex(part => part === source) + 3;
    test(`definition order ${anchor} precedes ${later[2] ?? later[1]}`, () => {
      assertFault(() => read("%stage s\n" + first), description, line, source.indexOf(anchor) + 1);
    });
  }
}

for (const [expression, message, anchor, rule] of [
  ...['"a" + "b"', '"a" < "b"', '{A} ≤ {B}', '1 > "x"', '1 ≥ {A}'].map(expr =>
    [expr, /requires number operands/, expr.split(" ")[1]]),
  ...["children", "source-text", "decomposed-source-text", "verbatim-text", "keys", "union", "error-free",
    "has(A)", "has-value(A)", "select({A})", "overlaps({A})", 'classify("x")', 'all($x ↦ $x = "a")',
    "at-most(3)", "any()", "tokens-after-first"].map(method => ['"a".' + method, /wrong receiver or arguments/, "."]),
  ["$.span.present", /wrong receiver or arguments/, ".present", '%rule r "a"'],
  ['("a").followed-by(r)', /wrong receiver or arguments/, ".followed-by", '%rule r "a"'],
  ["($.span).preceded-by(r)", /wrong receiver or arguments/, ".preceded-by", '%rule r "a"'],
  ["$y.all($x)", /wrong receiver or arguments/, ".all", '%rule r $x:"a" {$y:"b"}'],
  ["$y.any($x)", /wrong receiver or arguments/, ".any", '%rule r $x:"a" {$y:"b"}'],
  ["[$x ↦ $x]", /list cannot store a function/, "$x"],
  ["$x ↦ $y ↦ $y", /function cannot return a function/, "$y"],
  ['{_White_Space: "x"}', /cannot write an engine key/, "_White_Space"],
  ["{_White_Space}", /cannot write an engine key without provenance/, "_White_Space", '%rule r "a" →'],
]) {
  test(`closed type and owner of ${expression}`, () => {
    const clause = rule?.endsWith("→") ? rule + " " : rule ? rule + "\n%conditions " : "%const $X ";
    assertFault(() => read("%stage s\n" + clause + expression), message, rule && !rule.endsWith("→") ? 4 : 3,
      clause.split("\n").at(-1).length + expression.indexOf(anchor) + 1);
  });
}

for (const [source, anchor] of [
  ["%const $P #a<T>⁅ b ⁆", "<"],
  ['%const $P #a="x"⁅ b ⁆', "="],
  ["%const $P #f(X)<T>⁅ b ⁆", "<"],
  ['%rule g(@P) "x"\n%conditions $ ≅ #@P<T>⁅ b ⁆', "<"],
]) {
  test(`tested pattern cannot have children in ${source}`, () => {
    const lines = source.split("\n");
    assertFault(() => read("%stage s\n" + source), /only an untested rule atom/, lines.length + 2,
      lines.at(-1).indexOf(anchor) + 1);
  });
}

for (const [body, message, line, column] of [
  ['%rule r "a"\n%conditions $.parse(^"a" ^"b")', /more than one primary/, 4, 14],
  ['%rule f(@X) @X\n%rule r f((^"a" ^"b"))', /more than one primary/, 4, 11],
  ['%rule r "a"\n%conditions $.parse([^"a"])', /primary must mark/, 4, 14],
  ['%rule r "a"\n%conditions $.parse([+_White_Space])', /elidable optional/, 4, 14],
  ...["", "… ", " …"].map(remainder =>
    [`%rule r "a"\n%conditions $.parse(${remainder.startsWith("…") ? remainder : ""}{... "a" / ","}${remainder.endsWith("…") && !remainder.startsWith("…") ? remainder : ""})`,
      /chain cannot be the query target/, 4, 14]),
  ['%rule r ' + Array.from({ length: 17 }, () => '"a"').join(" & "), /at most sixteen operands/, 3, 1],
  ['%rule r {... $x:"a" / ","}', /chain item or separator cannot bind/, 3, 1],
  ['%rule r ({... "a" / ","})', /chain must occupy a whole alternative/, 3, 10],
  ['%rule r [^"a"]', /primary must mark/, 3, 1],
  ["%rule r ^*sub", /primary must mark/, 3, 1],
  ...['[+_White_Space]', '[+"a"]', '[+sub]', '[+T $x:"a"]'].map(body => ["%rule r " + body, /elidable optional/, 3, 1]),
  ["%const $N 01", /count literal/, 3, 1],
  ['%rule r "a"\n%conditions $.parse("a").at-most(01)', /count literal/, 4, 25],
  ['%const $X "a".ngrams(0)', /width must be positive/, 3, 14],
  ['%rule r {$x:"a"}\n%conditions $x.all()', /wrong number of arguments/, 4, 15],
  ['%rule r "a"\n%conditions $.parse($fooBar:"a")', /query cannot declare captures/, 4, 14],
  ['%rule r f(($fooBar:"a"))', /argument cannot read or declare captures/, 3, 11],
]) {
  test(`body or method fault at its DOM owner in ${body}`, () =>
    assertFault(() => read("%stage s\n" + body), message, line, column));
}

test("stored query and template body arguments receive the same shape checks", () => {
  const dom = read('%rule r f((^"a" "b")) %conditions $.parse(… "a" …)');
  const rule = dom.rules[0];
  const argument = rule.alternatives[0].expr.args[0];
  const query = rule.conditions[0].args[0];
  const [line, column] = rule.conditions[0].at;
  const atom = { literal: { string: "a" } };
  const primary = { primary: atom };
  for (const [body, message] of [
    [{ seq: [primary, primary] }, /more than one primary/],
    [{ choice: [primary, atom] }, /each route must have one primary/],
    [{ and: Array(17).fill(atom) }, /at most sixteen operands/],
    [{ optional: primary }, /primary must mark/],
    [{ optional: { ref: "_White_Space" }, elidable: true }, /elidable optional/],
  ]) {
    const valid = argument.body;
    argument.body = body;
    assertFault(() => validateDocument50(dom), message, 2, 11);
    argument.body = valid;
    query.body = { seq: [{ remainder: true }, body, { remainder: true }] };
    assertFault(() => validateDocument50(dom), message, line, column);
  }
  const chain = { repeat: atom, separator: { literal: { string: "," } }, chain: "left" };
  for (const body of [chain, { seq: [{ remainder: true }, chain] }, { seq: [chain, { remainder: true }] }]) {
    query.body = body;
    assertFault(() => validateDocument50(dom), /chain cannot be the query target/, line, column);
  }
  query.body = { seq: [{ remainder: true }, atom, { remainder: true }, { remainder: true }] };
  assertFault(() => validateDocument50(dom), /remainder only at each outer edge/, line, column);
});

test("an exact edit charges one depth level for its arguments", () => {
  const list = count => "[".repeat(count) + '"x"' + "]".repeat(count);
  const source = count => `%extend-rule f(= ${list(count)}) "a"`;
  assert.equal(read(source(255)).format, 50);
  assertFault(() => read(source(256)), /nested more than 256 deep/, 2, 1);
});

test("stored names use the canonical spelling of their name class", () => {
  for (const [source, mutate, description] of [
    ['%rule r "a"', dom => { dom.rules[0].name = "a--b"; }, /rule name/],
    ['%features normal', dom => { dom.directives[0].args[0] = "a--b"; }, /feature names/],
    ['%const $NAME {}', dom => { dom.constants[0].name = "lower"; }, /constant name/],
    ['%rule r A', dom => { dom.rules[0].alternatives[0].expr.ref = "_lu"; }, /tag name/],
    ['%const $X {A}', dom => { dom.constants[0].value.bag[0].key = "_lu"; }, /key name/],
    ['%const $X {A}', dom => { dom.constants[0].value.bag[0].key = "a--b"; }, /key name/],
  ]) {
    const dom = read(source);
    mutate(dom);
    assert.throws(() => validateDocument50(dom), description);
  }
});

for (const source of [
  '%const $V [["a"]]!($row ↦ $row.join())',
  '%const $V [["a"]]!.join()',
  '%const $V [["a"]]!.all($item ↦ $item = "a")',
  '%const $V [[{A}]]!($row ↦ $row.union)',
  '%const $V ["a"] ∈ [["a"]]',
  '%const $V [[1]] ∖ [1]',
  '%const $V [[1]] ∖ [[1]]',
  '%const $V (1 = 1 ? [["a"]] | [["b"]])↓.join()',
  '%const $V [[["a"]]]!($row ↦ $row↓.join())',
  '%const $V [*[], []]!.join()',
  '%const $V [f? 1, ¬f? "a"]',
  '%const $V [$UNRESOLVED, "a"].join()',
  '%const $V {flag: ¬(1 = 2)}',
  '%rule r → {value: 1}\n  | "a" → {*{value: "ok"}}',
  '%rule r → {value: 1}\n  | "a" → {({value: "ok"})\'value}',
  '%rule r → {image: 1}\n  | "a" → {({image: "ok"})\'image}',
  '%rule r\n  | "a" → {value: 1, *{value: "ok"}}',
  '%rule r "a" → {image: 1, *{*{image: "ok"}}}',
  '%rule r "a" → {value: 1, *$SUPPLIER}',
  '%rule r → {value: 1}\n  | "a" → {*$SUPPLIER}',
  '%rule r "a" → {f? value: 1}',
  '%rule r → {($b ∧ ¬$b)? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {($b ∧ $c)? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {(1 = 2)? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {({})? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {({A}.has(B))? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {((1 + 2) ≥ 4)? *$c.flags}\n  | [$b:A]\n  | $c:C',
  '%rule r → {($b ∧ $d)? *$c.flags}\n  | ($b:A | $d:B)\n  | $c:C',
  '%rule r → {k: ($b ? ($b ? "a" | $c\'value) | "b")}\n  | [$b:A]\n  | $c:C',
  '%rule r\n  | [$b:A]\n  | $c:C\n%emit ($b ∧ ¬$b)? ${*$c.flags}',
  '%const $GUARD {}\n%rule r → {($GUARD)? *$c.flags}\n  | [$b:A]\n  | $c:C',
]) {
  test(`closed types and applicable captures accept ${source}`, () => {
    const dom = read(source);
    assert.equal(validateDocument50(dom), dom);
  });
}

for (const [source, message, line, anchor] of [
  ['%const $V [1,"a"].join()', /common element type/, 2, ".join"],
  ['%const $V [1] ∈ [["a"]]', /requires compatible operands/, 2, "∈"],
  ['%const $V [[1]] ∖ ["a"]', /requires compatible operands/, 2, "∖"],
  ['%rule r $x:A %conditions $x ∈ [$x]', /requires compatible operands/, 2, "∈"],
  ['%rule r $x:A %conditions [$x] ∖ $x', /requires compatible operands/, 2, "∖"],
  ['%const $V [{a:1}] ∖ {a:1}', /requires compatible operands/, 2, "∖"],
  ['%const $V [$UNKNOWN, 1, "a"].join()', /common element type/, 2, ".join"],
  ['%const $V [["a"]]!.all($item ↦ $item.at-most(3))', /wrong receiver or arguments/, 2, ".at-most"],
  ['%const $V [[1]]!.join()', /wrong receiver or arguments/, 2, ".join"],
  ['%const $V [["a"]]↓.union', /wrong receiver or arguments/, 2, ".union"],
  ['%const $V (¬(1=2)) + 1', /requires number operands/, 2, "+ 1"],
  ['%const $V (1=1 ∧ 2=2) + 1', /requires number operands/, 2, "+ 1"],
  ['%const $V (1=1 ∨ 2=2) + 1', /requires number operands/, 2, "+ 1"],
  ['%const $V (¬(1=2)).split("x")', /wrong receiver or arguments/, 2, ".split"],
  ['%const $V 1 = (¬(1=2))', /requires comparable operands/, 2, "= ("],
  ['%rule r A → {value: ¬(1=2)}', /a value or image needs a string/, 2, "¬"],
  ['%rule r → {value: 1}\n  | "a" → {({})\'value}', /a value or image needs a string/, 2, "value: 1"],
  ['%rule r "a" → {value: 1, *{value: "ok", ¬value}}', /a value or image needs a string/, 2, "value: 1"],
  ['%rule r → {value: "ok"}\n  | "a" → {*{value: 1}}', /a value or image needs a string/, 3, "*"],
  ['%rule r → {value: "ok"}\n  | "a" → {({value: 1})\'value}', /a value or image needs a string/, 3, "("],
  ['%rule r → {($b ∨ $c)? *$c.flags}\n  | [$b:A]\n  | $c:C', /\$c is absent/, 2, ".flags"],
  ['%rule r → {($b ∧ ¬$b)? *$never.flags}\n  | [$b:A]\n  | $c:C', /captured by no alternative/, 2, ".flags"],
]) {
  test(`closed type or scope fault in ${source}`, () => {
    assertFault(() => read(source), message, line, source.split("\n")[line - 2].indexOf(anchor) + 1);
  });
}

test("independent guards use separate presence witnesses", () => {
  const names = Array.from({ length: 24 }, (_, index) => "x" + index);
  const entries = names.map(name => `($${name} ∧ ¬$${name})? *$c.flags`).join(", ");
  const optionals = names.map(name => `[$${name}:A]`).join(" ");
  const source = `%rule r → {${entries}}\n  | ${optionals}\n  | $c:C`;
  assert.equal(read(source).format, 50);
});

for (const present of ["$b", "$b.present"]) {
  for (const [body, missing] of [
    ["[$b:+B]", true],
    ["[$b:B]", true],
    ["$b:B", false],
    ["[$b:+B<¬_Elided>]", false],
    ["[$b:+B≠\"\"]", false],
    ["[$b:+B=\"b\"]", true],
    ["A [D [$b:B]]", true],
    ["(D | $b:B)", true],
    ["(D ≻ $b:B)", true],
    ["D & $b:B", true],
    ["[{$b:B}]", true],
    ["{($b:B | D)}", true],
    ["{D / $b:B}", true],
    ["{$b:B}", false],
  ]) {
    test(`scope follows the structural routes of ${body} with ${present}`, () => {
      const head = `%rule r → {(¬${present})? *$c.flags}`;
      const source = head + "\n | " + body + "\n | $c:C";
      if (missing) assertFault(() => read(source), /\$c is absent/, 2, head.indexOf(".flags") + 1);
      else assert.equal(read(source).format, 50);
    });
  }
}

for (const [head, first, after, capture, line, anchor] of [
  ["%rule r → {k: ($b ? $c'k | $d'k)}", "[$b:B]", "", "d", 2, "$d'"],
  ["%rule r → {k: (¬$b ? $d'k | $c'k)}", "[$b:B]", "", "d", 2, "$d'"],
  ["%rule r → {k: ($b ? $c'k | $d'k)}", "B\n | $b:B", "", "d", 2, "$d'"],
  ["%rule r → {$b? *$c.flags, (¬$b)? *$d.flags}", "[$b:B]", "", "d", 2, "$d."],
  ["%rule r → {$b? *$c.flags}", "[$b:B] → {(¬$b)? *$d.flags}", "", "d", 3, "$d."],
  ["%rule r → {$b? *$c.flags}", "A [$b:B]", "\n%error ($b ? \"ok\" | $d'k)", "d", 5, "$d'"],
  ["%rule r", "A [$b:B]", "\n%emit $b? ${*$c.flags}, (¬$b)? ${*$d.flags}", "d", 5, "$d."],
  ["%rule r → {$first? *$c.flags, $second? *$d.flags}", "[$first:F] [$second:S] B", "", "d", 2, "$d."],
  ["%rule r → {$q? *$c.flags, $b? *$d.flags}", "$b:B & $q:Q", "", "d", 2, "$d."],
  ["%rule r → {$b? *$c.flags, (¬$b)? *$d.flags}", "($b:B | A)", "", "c", 2, "$c."],
  ["%rule r → {($a ∧ $b)? *$c.flags, $b? *$d.flags}", "{($a:A | $b:B)}", "", "d", 2, "$d."],
  ["%rule r → {($a ∧ $b)? *$c.flags}", "{($a:A | $b:B)}", "", "c", 2, "$c."],
  ["%rule r → {$b? *$c.flags, (¬$b)? *$d.flags}", "{A / $b:B}", "", "d", 2, "$d."],
  ["%rule r → {(¬$b)? *$c.flags, (¬$b)? *$d.flags}", "[$b:B]", "", "c", 2, "$c."],
]) {
  const source = `${head}\n | ${first}\n | $c:C $d:D${after}`;
  test(`the first failing expansion of ${source} reads $${capture}`, () => {
    const row = source.split("\n")[line - 2];
    assertFault(() => read(source), new RegExp(`\\$${capture} is absent`), line, row.indexOf(anchor) + 3);
  });
}

test("the first site wins when scope and type faults share an expansion", () => {
  const head = '%rule r → {k: "x" + 1, (¬$b)? *$c.flags}';
  const source = head + "\n | [$b:B]\n | $c:C";
  assertFault(() => read(source), /requires number operands/, 2, head.indexOf("+") + 1);
  const guarded = '%rule r → {($d\'k)? *("x" + 1)}';
  assertFault(() => read(guarded + "\n | A\n | $d:D"), /\$d is absent/, 2, guarded.indexOf("'") + 1);
});

test("a capture of an empty rule still binds a node", () => {
  const source = '%rule r → {(¬$b.present)? *$c.flags}\n | $b:empty\n | $c:C\n%rule empty ε';
  assert.equal(read(source).format, 50);
});

for (const expr of [
  '[].all($x ↦ $x = "a")',
  '["a"].all($x ↦ $x = "a")',
  '[]!($x ↦ $x ≠ 1)',
  '[1]!($x ↦ $x ≠ 1)',
  '[].any($x ↦ $x < 1)',
  '[].any($x ↦ 1 ≥ $x)',
  '[].all($x ↦ $x ⊆ {A})',
  '[].all($x ↦ {A} ⊈ $x)',
  '[].all($x ↦ $x ∈ [[1]])',
  '[].all($x ↦ 1 ∉ $x)',
  '[].all($x ↦ ¬($x ∖ {A}))',
  '[].all($x ↦ ¬([1] ∖ $x))',
  '[].all($x ↦ ($x ∪ {A}) = {A})',
  '[].all($x ↦ ($x ∩ {A}) = {A})',
  '[].all($x ↦ $x ≅ #a)',
]) {
  test(`an empty list element takes its type from ${expr}`, () => {
    assert.equal(read("%const $V " + expr).format, 50);
  });
}

for (const [expr, anchor] of [
  ['[1].all($x ↦ $x = "a")', " = "],
  ['[].all($x ↦ $x = [1])', " = "],
  ['[] = [1]', " = "],
  ['[].all($x ↦ $x ∈ [{a: 1}])', " ∈ "],
]) {
  test(`a comparable operand is still required in ${expr}`, () => {
    const source = "%const $V " + expr;
    assertFault(() => read(source), /requires comparable operands|requires compatible operands/,
      2, source.indexOf(anchor) + 2);
  });
}

function reverseMembers(value) {
  if (Array.isArray(value)) return value.map(reverseMembers);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseMembers(child)]));
}

function compareDiagnostics(source, dom, message, [line, column]) {
  let expected;
  assert.throws(() => read(source), error => {
    assert.match(error.description, message);
    assert.deepEqual(error.where, { document: "probe.md", line, column });
    expected = error;
    return true;
  });
  for (const record of [JSON.parse(JSON.stringify(dom)), reverseMembers(dom)]) {
    assert.throws(() => validateDocument50(record, { document: "probe.md", unicode: compiler.unicode }), error => {
      assert.equal(error.kind, expected.kind);
      assert.equal(error.description, expected.description);
      assert.deepEqual(error.where, expected.where);
      return true;
    });
  }
}

for (const [name, term] of [
  ["conditional", "{k: ($.span.starts-input ? $c'k | $d'k)}"],
  ["conditional test and branches", "{k: ($c'k ? $d'k | $d'k)}"],
  ["implication", "{($c'k ⟹ $d'k)? k}"],
  ["comparison", "{($c'k = $d'k)? k}"],
  ["addition", "{k: $c'k + $d'k}"],
  ["concatenation", "{k: $c'k ++ $d'k}"],
  ["conjunction", "{($c'k ∧ $d'k)? k}"],
  ["disjunction", "{($c'k ∨ $d'k)? k}"],
  ["union", "{k: $c'k ∪ $d'k}"],
  ["intersection", "{k: $c'k ∩ $d'k}"],
  ["difference", "{k: $c'k ∖ $d'k}"],
  ["method receiver and argument", "{k: $c'k.join($d'k)}"],
  ["map receiver and short selector", "{k: $c'k!.select($d'k)}"],
  ["map receiver and named binder", "{k: $c'k!($each ↦ $d'k)}"],
  ["guard and copy source", "{($c'k)? $d'k}"],
  ["guard and written value", "{($c'k)? k: $d'k}"],
  ["guard and list item", "{k: [($c'k)? $d'k]}"],
  ["guard and splat", "{($c'k)? *$d'k}"],
  ["bag entries", "{k: $c'k, j: $d'k}"],
  ["list items", "{k: [$c'k, $d'k]}"],
]) {
  test(`source and supplied DOM agree on the operand order of ${name}`, () => {
    const head = "%rule r → " + term;
    const dom = read(head + "\n | $c:C $d:D\n | $c:C $d:D");
    dom.rules[0].alternatives[0].expr = { ref: "A" };
    compareDiagnostics(head + "\n | A\n | $c:C $d:D", dom, /\$c is absent/, [2, head.indexOf("$c'k") + 3]);
  });
}

test("a supplied output guard precedes the output term", () => {
  const emit = "%emit ($c'k)? ${k: $d'k}";
  const dom = read("%rule r\n | $c:C $d:D\n | $c:C $d:D\n" + emit);
  dom.rules[0].alternatives[0].expr = { ref: "A" };
  compareDiagnostics("%rule r\n | A\n | $c:C $d:D\n" + emit, dom, /\$c is absent/, [5, emit.indexOf("$c'k") + 3]);
});

test("a supplied method visits the receiver before it infers a predicate binder", () => {
  const leaf = '%const $A ["x"].all($x ↦ $x = "a")';
  const dom = read(leaf);
  const comparison = dom.constants[0].value.args[0].body;
  dom.constants[0].value.receiver.list[0].value = { integer: "123" };
  compareDiagnostics(leaf.replace('"x"', "123"), dom, /operands of one type/, comparison.at);
});

for (const [name, source, getOperands] of [
  ["a body repeat", "%rule r {f(= 255) / g(= 254)}", dom => {
    const { repeat, separator } = dom.rules[0].alternatives[0].expr;
    return [repeat, separator];
  }],
  ["a pattern call", "%const $P #f(= 255)⁅ g(= 254) ⁆", dom => {
    const pattern = dom.constants[0].value.pattern;
    return [pattern, pattern.children[0].child];
  }],
  ["a pattern repeat", "%const $P #⁅ {f(= 255) / g(= 254)} ⁆", dom => {
    const [{ repeat, separator }] = dom.constants[0].value.pattern.children;
    return [repeat[0].child, separator[0].child];
  }],
  ["two call arguments", "%rule r f(= 255, = 254)", dom => {
    const { args } = dom.rules[0].alternatives[0].expr;
    return args.map(arg => ({ args: [arg] }));
  }],
]) {
  test(`source and supplied DOM agree on operands of ${name}`, () => {
    const dom = read(source);
    const [first, second] = getOperands(dom).map(call => call.args[0]);
    first.expression.integer = "256";
    second.expression.integer = "257";
    compareDiagnostics(source.replace("255", "256").replace("254", "257"), dom, /count literal/, first.at);
  });
}

test("a supplied exact edit visits its head before its statement term and body", () => {
  const source = "%extend-rule f(= 255) → {k: 254}\n | g(= 253)";
  const dom = read(source);
  const rule = dom.rules[0];
  rule.args[0].expression.integer = "256";
  rule.term.bag[0].value.integer = "257";
  rule.alternatives[0].expr.args[0].expression.integer = "258";
  compareDiagnostics(source.replace("255", "256").replace("254", "257").replace("253", "258"),
    dom, /count literal/, rule.args[0].at);
});

test("supplied names use the first unknown read in semantic order", () => {
  const head = "%rule r → {k: ($c'k ? $d'k | $e'k)}";
  const body = "\n | $c:C $d:D $e:E";
  const dom = read(head + body);
  const { value } = dom.rules[0].term.bag[0];
  value.if.receiver.capture = "x";
  value.then.receiver.capture = "y";
  value.else.receiver.capture = "z";
  compareDiagnostics(head.replace("$c", "$x").replace("$d", "$y").replace("$e", "$z") + body,
    dom, /\$x is captured by no alternative/, value.if.at);
});

test("supplied type faults use the written operand order", () => {
  const source = "%const $N ((123 + 1) = (2 + 123))";
  const dom = read(source);
  const { left, right } = dom.constants[0].value;
  left.left = { string: "x" };
  right.right = { string: "y" };
  compareDiagnostics(source.replace("123", '"x"').replace("123", '"y"'),
    dom, /requires number operands/, left.at);
});

for (const [name, source, getSymbol] of [
  ["body test", '%rule r f(= 255)<A>="x"', dom => dom.rules[0].alternatives[0].expr],
  ["pattern test", '%const $P #f(= 255)<A>="x"', dom => dom.constants[0].value.pattern],
]) {
  test(`a supplied ${name} retains the tested symbol fault with both tests`, () => {
    const dom = read(source);
    const filter = getSymbol(dom).expr;
    const [actual] = filter.expr.args;
    actual.expression.integer = "256";
    compareDiagnostics(source.replace("255", "256"), dom, /count literal/, actual.at);
  });
}

test("a supplied elidable optional visits its body with the written default present", () => {
  const source = '%rule r [+T ≝ "end" f(= 255)]';
  const dom = read(source);
  const [actual] = dom.rules[0].alternatives[0].expr.optional.seq[1].args;
  actual.expression.integer = "256";
  compareDiagnostics(source.replace("255", "256"), dom, /count literal/, actual.at);
});

test("the elidable head's default precedes the tail in both DOM orders", () => {
  const dom = read("%rule r [+T=$H ≝ $D f(= $S)]");
  const optional = dom.rules[0].alternatives[0].expr;
  optional.default.const = "badDefault";
  optional.optional.seq[1].args[0].expression.const = "badTail";
  for (const record of [dom, reverseMembers(dom)]) {
    assertFault(() => validateDocument50(record), /invalid constant name/, 2, 18);
  }
});

for (const [source, message, line, column] of [
  ["%rule r f(= {A, A}, = $x)", /duplicate direct write for A/, 2, 17],
  ["%rule r A\n%conditions $.span.parse($x:A).parse($y:B)", /a query cannot declare captures/, 3, 19],
  ['%const $V "x".xxxxx().yyyyy()', /unknown method \.xxxxx/, 2, 14],
]) {
  test(`source and DOM validate the earlier operand in ${source}`, () => {
    let dom;
    const reader = createObserved(reading => {
      differential.observe(reading);
      dom = reading.dom;
    });
    assertFault(() => reader.compileDocument(fenced(source), "probe.md"), message, line, column);
    assert.ok(dom);
    for (const record of [dom, reverseMembers(dom)]) {
      assertFault(() => validateDocument50(record), message, line, column);
    }
  });
}

for (const name of ["names", "include", "stage", "features", "elision-only",
  "ambiguity-resolution", "extend-stage", "redefine-stage"]) {
  test(`directive spelling ${name} can name a rule template and feature`, () => {
    const dom = read([
      '%names "data/unicode/unicode-names.txt"',
      "%stage main",
      `%features ${name}`,
      "%ambiguity-resolution greedy",
      `%rule ${name}(@X) @X`,
      `%extend-rule ${name}(A) B`,
      `%redefine-rule ${name}(C) D`,
      `%rule text ${name}(A)`,
    ].join("\n"));
    assert.deepEqual(dom.directives.map(directive => directive.name),
      ["names", "stage", "features", "ambiguity-resolution"]);
    assert.deepEqual(dom.directives[2].args, [name]);
    assert.deepEqual(dom.rules.slice(0, 3).map(rule => [rule.name, rule.op]),
      [[name, "define"], [name, "extend"], [name, "redefine"]]);
    assert.deepEqual(dom.rules[0].params, ["X"]);
    assert.deepEqual([dom.rules[1].args[0].tag, dom.rules[2].args[0].tag], ["A", "C"]);
    for (const reading of [dom, reverseMembers(dom)]) {
      assert.equal(validateDocument50(reading, { unicode: compiler.unicode }), reading);
    }
  });
}

test("the names directive still needs the preamble after a names instance edit", () => {
  const rules = "%rule names(@X) @X\n%extend-rule names(A) B";
  const directive = '%names "data/unicode/unicode-names.txt"';
  assertFault(() => read(rules + "\n" + directive), /%names must precede/, 4, 1);
  const dom = read(rules);
  dom.directives.push({ name: "names", args: ["data/unicode/unicode-names.txt"], at: [4, 1] });
  assertFault(() => validateDocument50(dom), /%names must precede/, 4, 1);
});
