// Reads that recognition decides on tags must give the answer of the bags,
// or fail at load (src/format50/observations.js). Each case runs with the
// oracle of the stage on, which checks the chosen tree on the real bags.
import test from "node:test";
import assert from "node:assert/strict";
import { loaderForNotation } from "../src/node.js";
import { withOracle, oracleProblems } from "./oracle.js";
import { OBSERVATIONS } from "../src/format50/observations.js";

const loaders = loaderForNotation(50);
const HEAD = ["%stage main", "%ambiguity-resolution greedy"];
const fence = (/** @type {string[]} */ lines) => ["```jbogenbau", ...lines, "```", ""].join("\n");
/** @param {string} text @param {...string} keys */
const tok = (text, ...keys) => ({ text, props: Object.fromEntries(keys.map(key => [key, true])) });

/**
 * The verdict of a grammar on caller tokens: "ok", the kind of the parse
 * error, or "load: MESSAGE". A disagreement of the oracle fails the test.
 * @param {string[] | Record<string, string[]>} source
 * @param {any[]} tokens
 */
function verdict(source, tokens) {
  let pipeline;
  try {
    const sources = Array.isArray(source) ? { "p.md": fence(source) } : Object.fromEntries(Object.entries(source).map(([name, lines]) => [name, fence(lines)]));
    pipeline = loaders.loadPipelineSources(sources, "p.md");
  } catch (error) {
    return `load: ${/** @type {Error} */ (error).message}`;
  }
  const supplied = tokens.map((token, index) => ({ ...token, span: [index, index + 1], source: [index * 2, index * 2 + 1] }));
  const { value: result, checks } = withOracle(() => pipeline.parse(tokens.map(token => token.text).join(" "), { tokens: supplied }));
  assert.deepEqual(oracleProblems(checks), []);
  return result.ok ? "ok" : result.error.kind === "grammar" ? `grammar: ${result.error.message}` : result.error.kind;
}

test("each row of the table of observations states its form, receivers and proof", () => {
  for (const row of OBSERVATIONS.values()) {
    assert.ok(row.form && row.proof && row.receivers.length, row.id);
  }
});

test("the hidden tags of a bag keep each fact that recognition reads", () => {
  // A bare lowercase key of a caller token is present.
  assert.equal(verdict([...HEAD, "%rule text $t:A", "%conditions $t.has(note)"], [tok("a", "A", "note")]), "ok");
  assert.equal(verdict([...HEAD, "%rule text $t:A", "%conditions ¬$t.has(note)"], [tok("a", "A", "note")]), "rejected");
  // A payload of an earlier stage compares with a literal and with a
  // computed string, whatever the writes of this stage.
  const first = ["%stage first", "%ambiguity-resolution greedy", "%const $OUTPUTS {A, kind}", "%rule text {item}", '%rule item $a:A → {A, kind: "x", image: value: $a\'value}', "%emit"];
  const second = (/** @type {string} */ condition) => ["%stage second", "%ambiguity-resolution greedy", "%rule text $t:A $u:A", `%conditions ${condition}`];
  for (const [condition, expected] of [
    ['$t.has-value(kind) ⟹ $t\'kind ≠ "y"', "ok"], ['$t.has-value(kind) ∧ $t\'kind = "x"', "ok"], ['$t.has-value(kind) ∧ $t\'kind ≠ "x"', "rejected"],
    ["$t.has-value(kind) ∧ $t'kind = $u'value", "ok"], ["$t.has-value(kind) ∧ $t'kind ≠ $u'value", "rejected"],
  ]) {
    assert.equal(verdict([...first, ...second(condition)], [tok("x", "A"), tok("x", "A")]), expected, condition);
  }
  // Two payloads of the input compare by their values, which the writes of
  // the stage do not list.
  assert.match(verdict([...first, ...second("$t.has-value(kind) ∧ $u.has-value(kind) ∧ $t'kind = $u'kind")], [tok("x", "A"), tok("x", "A")]),
    /^(load|grammar): .*cannot yet order or combine the payload kind/);
  // A later write replaces the value of a key with no finite domain, a
  // deletion drops it, and a copy keeps it.
  const run = [...HEAD, "%rule inner $c:A → {run: $c'value}"];
  assert.equal(verdict([...run, "%rule text $o:outer $x:A", "%conditions $o'run = $x'value", "%rule outer ^$i:inner $d:B → {run: $d'value}"],
    [tok("a", "A"), tok("b", "B"), tok("a", "A")]), "rejected");
  assert.equal(verdict([...run, "%rule text $o:outer $x:B", "%conditions $o'run = $x'value", "%rule outer ^$i:inner $d:B → {run: $d'value}"],
    [tok("a", "A"), tok("b", "B"), tok("b", "B")]), "ok");
  assert.equal(verdict([...run, "%rule text $w:wrap $x:A", "%conditions $w'run = $x'value", "%rule wrap $i:inner B → {$i'run}"],
    [tok("a", "A"), tok("b", "B"), tok("a", "A")]), "ok");
  assert.equal(verdict([...run, "%rule text $w:wrap", "%conditions $w.has(run)", "%rule wrap ^$i:inner → {¬run}"], [tok("a", "A")]), "rejected");
  assert.equal(verdict([...run, "%rule text $w:wrap", "%conditions ¬$w.has(run)", "%rule wrap ^$i:inner → {¬run}"], [tok("a", "A")]), "ok");
  // A splat of a bag with the key replaces the earlier value.
  assert.equal(verdict([...run, "%rule text $w:wrap $x:A", "%conditions $w'run = $x'value", '%rule wrap $i:inner → {run: "z", *$i}'],
    [tok("a", "A"), tok("a", "A")]), "ok");
  assert.equal(verdict([...run, "%rule text $w:wrap", '%conditions $w\'run = "z"', '%rule wrap $i:inner → {run: "z", *$i}'], [tok("a", "A")]), "rejected");
  // .keys holds keys with no tags, so recognition refuses it.
  for (const condition of ["$x.keys ⊆ {A}", "$x.keys = {A}", "$x.keys.overlaps({note})"]) {
    assert.match(verdict([...HEAD, "%rule text $x:r", `%conditions ${condition}`, "%rule r ^A → {note}"], [tok("a", "A")]), /^load: .*cannot yet read \.keys/, condition);
  }
});

test("a guard of a shared clause keeps its meaning on each alternative", () => {
  const body = [...HEAD, "%rule text", "  | A", "  | $d:D $b:B"];
  assert.equal(verdict([...body, "%conditions $d ⟹ $b"], [tok("a", "A")]), "ok");
  assert.equal(verdict([...body, "%conditions ¬$d ∨ $b"], [tok("a", "A")]), "ok");
  assert.equal(verdict([...body, "%conditions $d ⟹ $b"], [tok("d", "D"), tok("b", "B")]), "ok");
  assert.equal(verdict([...HEAD, "%rule text", "  | [$d:D] A", "  | $d:D $b:B", "%conditions $d ⟹ $b"], [tok("a", "A")]), "ok");
  assert.equal(verdict([...HEAD, "%rule text", "  | [$d:D] A", "  | $d:D $b:B", "%conditions $d ⟹ $b"], [tok("d", "D"), tok("a", "A")]), "rejected");
});

test("each recognition read of a value of a node needs the certificate of what it can bind", () => {
  const joins = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";
  const proof = /^(load|grammar): .*has no proof that the value equals the join of its input/;
  for (const [lines, tokens] of /** @type {[string[], any[]][]} */ ([
    [["%rule text $r:r", '%conditions $r\'value = "ab"', "%rule r $g:(A B)"], [tok("a", "A"), tok("b", "B")]],
    [[joins, "%rule text $r:r", '%conditions $r\'value = "ab"', "%rule r $g:(^A B)"], [tok("a", "A"), tok("b", "B")]],
    [['%rule text t(A)="a"', '%rule t(@X) @X → {value: "z", image: "z"}'], [tok("a", "A")]],
    [[joins, "%rule text ($x:a | $x:b)", '%conditions $x\'value = "a"', '%rule a A → {value: "z", image: "z"}', "%rule b B"], [tok("a", "A")]],
    [[joins, "%rule text $x:A", '%conditions $x ≅ #·r="a"', '%rule r A → {value: "z", image: "z"}'], [tok("a", "A")]],
    [['%rule text A → {value: "z", image: "z"}', '%conditions $\'value = "a"'], [tok("a", "A")]],
    [[joins, "%rule text $r:r", '%conditions $r\'value = "a"', "%rule r A", "%erased"], [tok("a", "A")]],
  ])) {
    assert.match(verdict([...HEAD, ...lines], tokens), proof, lines.join(" / "));
  }
  // An image has no certificate: recognition reads it only on a leaf.
  assert.match(verdict([...HEAD, "%rule text $x:r", '%conditions $x\'image = "Z"', '%rule r A → {image: "Z", value: "a"}'], [tok("a", "A")]),
    /^(load|grammar): .*cannot yet read the image of \$x, which no certificate covers/);
  assert.equal(verdict([...HEAD, "%rule text $x:A", '%conditions $x\'image = "a"'], [tok("a", "A")]), "ok");
  // A certified rule reads in recognition.
  assert.equal(verdict([...HEAD, joins, "%rule text $r:r", '%conditions $r\'value = "ab"', "%rule r A B"], [tok("a", "A"), tok("b", "B")]), "ok");
});

test("a key of the stage defaults fails every recognition read of the keys of a node", () => {
  const head = [...HEAD, "%const $DEFAULTS $n ↦ {K}", "%rule r A B"];
  const tokens = [tok("a", "A"), tok("b", "B")];
  for (const lines of [["%rule text r<K>"], ["%rule text r<¬K>"], ["%rule text $x:r", "%conditions $x ≅ #·r<K>"]]) {
    assert.match(verdict([...head, ...lines], tokens), /^load: .*cannot yet read the keys of r, because the stage defaults can give it the key K/, lines.join(" / "));
  }
  assert.match(verdict([...head, "%rule text $x:r", "%conditions $x'K"], tokens), /^load: .*cannot yet read the key K that the stage defaults give a node/);
  // A compound binding starts with the defaults too.
  assert.match(verdict([...HEAD, "%const $DEFAULTS $n ↦ {K}", "%rule text $x:(A B)", "%conditions $x'K"], tokens), /^load: .*cannot yet read/);
});
