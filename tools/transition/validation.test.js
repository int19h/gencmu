import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createTransitionCompiler } from "../transition-compiler.js";
import { validateDefinitionNullability50, validateDocument50 } from "../../lib/js/src/format50/validate.js";

const compiler = createTransitionCompiler();
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
  ...["^(T)", "^($x:A)", "^*sub", "^$x:*sub"].map(body =>
    ["%rule r " + body, /ungrouped symbol or capture/]),
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
  const custom = createTransitionCompiler(file => file === "data/unicode/unicode.txt" ? core : undefined);
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
  const supplied = createTransitionCompiler(file => file === core ? bundledCore + "\n" :
    file === properties ? bundledProperties : undefined);
  assert.deepEqual(supplied.compileDocument(fenced("%rule text _Alphabetic")).rules[0].alternatives[0].expr,
    { ref: "_Alphabetic" });
  const coreOnly = createTransitionCompiler(file => file === core ? bundledCore : undefined);
  assert.throws(() => coreOnly.compileDocument(fenced("%rule text _Alphabetic")), /unknown or forbidden engine key/);
});
