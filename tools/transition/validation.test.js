import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createTransitionCompiler } from "../transition-compiler.js";

const compiler = createTransitionCompiler();
const fenced = source => "\x60\x60\x60jbogenbau\n" + source + "\n\x60\x60\x60";
const read = source => compiler.compileDocument(fenced(source), "probe.md");

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
  ["%rule r [$x:A] $x:B", /binds \$x twice/, 16],
  ["%rule r f(= $.span)", /argument cannot read or declare captures/],
  ["%rule r f(= $x ↦ [1]!($x ↦ $x))", /cannot hide a live name/],
  ["%const $K {K,K}", /duplicate direct write/, 14],
  ["%rule r ^A → {k:1,k:2}", /duplicate direct write/, 19],
  ["%const $K $x ↦ {k,$x'k}", /duplicate direct write/],
  ["%const $K {f? k:k:1}", /duplicate direct write/],
  ["%const $N 256", /count literal/, 11],
  ["%rule r A %conditions $.at-most(256)", /count literal/],
  ["%const $INPUTS {}", /supplied by the engine/],
  ["%redefine-const $INPUTS {}", /supplied by the engine/],
  ["%ambiguity-resolution most #r", /exact local pattern/, 28],
  ["%rule r T %suppress-warnings a_b", /invalid warning code/],
  ["%rule r _Bogus<A><B>", /once in that order/, 18],
  ["%rule f(A) = g(A)", /plain rule name/, 7],
  ['%const $K {K,K}\n%rule f(A) = g(A)', /duplicate direct write/],
]) {
  test(source, () => assert.throws(() => read(source), error =>
    error.kind === "grammar" && message.test(error.description) &&
      (column === undefined || error.where.column === column), message.source));
}

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
