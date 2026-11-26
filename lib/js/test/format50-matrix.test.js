// A differential matrix of the bridge (cause B of the Eberban review). Each
// truth expression runs in seven recognition contexts, which the bridge
// translates for the format 49 recognizer, and in one late context, which
// the format 50 evaluator runs itself. A context that cannot translate an
// expression must fail at load. Where it loads, it must agree with the
// late evaluation on every input.
import test from "node:test";
import assert from "node:assert/strict";
import { loaderForNotation } from "../src/node.js";

const loaders = loaderForNotation(50);
const DEFAULTS = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";
const CONSTANTS = ['%const $M ["a", "b"]', '%const $L [*$M, "c"]', "%const $RAW $x ↦ $x.tokens!'value.join()", '%const $S "a"'];

// A first stage gives the tokens their payloads, which a caller token
// cannot carry: PX gives P "x", N 1 and Mark, PY gives P "y" and N 2.
const PRE = ["%stage pre", "%ambiguity-resolution greedy", DEFAULTS, "%const $OUTPUTS {A, B, P, N, Mark, Q}", "%rule text {tok}",
  "%rule tok $t:A → {A, $t.has(PX)? P: \"x\", $t.has(PX)? N: 1, $t.has(PX)? Mark, $t.has(PY)? P: \"y\", $t.has(PY)? N: 2}",
  "  | $t:B → {B, $t.has(QQ)? Q}", "%emit"];

/** @param {string[]} lines */
function pipelineOf(lines) {
  return loaders.loadPipelineSources({ "p.md": ["```jbogenbau", ...PRE, "%stage main", "%ambiguity-resolution greedy", DEFAULTS, ...CONSTANTS, ...lines, "```", ""].join("\n") }, "p.md");
}

// The expressions read the two captures $a and $b of rule r.
const EXPRESSIONS = [
  "$a'value = \"a\"",
  "$a'value ≠ $b'value",
  "$a'value = $S",
  "$a.has(P) ∧ ($a'P = \"x\")",
  "$a.has(P) ∧ ($a'P ≠ \"x\")",
  "$a.has(P)",
  "$a.has-value(P)",
  "$a'value ∈ [\"a\", \"c\"]",
  "$a'value ∈ $L",
  "$a'value ∈ [*$M]",
  "($a'value ++ $b'value) = \"ab\"",
  "$a.flags'Mark",
  "{Mark} ⊆ $a.flags",
  "$a.has(N) ∧ ($a'N + 1 = 2)",
  "$a.has(N) ∧ ($a'N < 2)",
  "$RAW($a) = \"a\"",
  "$RAW($a.span) ≠ $b'value",
  "¬($a'value = \"a\") ∨ ($b'value = \"b\")",
  "($a'value = \"a\") ∧ $b.has(Q)",
  "$a.span.source-text = \"a\"",
  "$a.flags ⊆ {A, Mark}",
  "{A, Mark} ⊆ $a.flags",
  "$a.flags.overlaps({Mark, Q})",
  "$a.keys'Mark",
  "$a.flags.select({Mark}) = {Mark}",
  "($a'value = \"a\" ? $b'value = \"a\" | $b'value = \"b\")",
  "$a'value ∈ [\"a\", ($b'value = \"a\")? \"b\"]",
  "$a'value ∈ \"a,b\".split(\",\")",
  "[$a'value, $b'value].join(\"-\") = \"a-b\"",
  "$a.span.tokens!'value.join() = \"a\"",
  "$b.has(Q) ∨ $a.has(Mark)",
  "¬$a.flags'Mark",
  "$a.flags = {A}",
];

// Each input is two tokens: one with key A, then one with key B.
/** @type {any[][]} */
const INPUTS = [];
for (const first of ["a", "b", "c"]) for (const second of ["a", "b"]) for (const extra of [{}, { PX: true }, { PY: true }]) {
  INPUTS.push([
    { text: first, props: { A: true, ...extra } },
    { text: second, props: { B: true, ...(extra.PX ? { QQ: true } : {}) } },
  ]);
}

/** @param {any[]} tokens */
function supplied(tokens) {
  let offset = 0;
  return tokens.map((token, index) => {
    const source = [offset, offset + token.text.length];
    offset += token.text.length + 1;
    return { ...token, span: [index, index + 1], source };
  });
}

/**
 * Loads a pipeline, or gives the load error.
 * @param {string[]} lines
 * @returns {{pipeline: any} | {error: any}}
 */
function load(lines) {
  try {
    return { pipeline: pipelineOf(lines) };
  } catch (error) {
    return { error };
  }
}

for (const expression of EXPRESSIONS) {
  test(`the bridge agrees with the late evaluation of ${expression}`, () => {
    const rule = "%rule r $a:A $b:B";
    // The oracle: the term guard, evaluated after the choice of a parse.
    const late = load(["%const $OUTPUTS {K}", "%rule text r", `${rule} → {(${expression})? K}`, "%emit"]);
    assert.ok("pipeline" in late, `the late form must load: ${"error" in late ? late.error.message : ""}`);
    const guarded = `${rule} → {(${expression})? K}`;
    // Each context with the answer that it gives where the guard holds.
    /** @type {Record<string, [ReturnType<typeof load>, boolean]>} */
    const contexts = {
      condition: [load(["%rule text r", rule, `%conditions ${expression}`]), true],
      filter: [load(["%rule text r<K>", guarded]), true],
      negatedFilter: [load(["%rule text r<¬K>", guarded]), false],
      statementTerm: [load(["%rule text r<K>", `%rule r → {(${expression})? K} | $a:A $b:B`]), true],
      flagRead: [load(["%rule text $x:r", "%conditions $x.flags'K", guarded]), true],
      patternTest: [load(["%rule text $x:r", "%conditions $x ≅ #r<K>", guarded]), true],
      termValue: [load(["%rule text r=\"y\"", `${rule} → {value: ((${expression}) ? "y" | "n")}`]), true],
    };
    for (const [name, [context, holds]] of Object.entries(contexts)) {
      if ("error" in context) {
        // A context that cannot translate the expression says so at load.
        assert.equal(context.error.kind, "grammar", `${name}: ${context.error.message}`);
        continue;
      }
      // A lowering error at the parse is loud too.
      const probe = context.pipeline.parse(INPUTS[0].map(token => token.text).join(" "), { tokens: supplied(INPUTS[0]) });
      if (probe.error?.kind === "grammar") continue;
      for (const input of INPUTS) {
        const text = input.map(token => token.text).join(" ");
        const oracle = /** @type {any} */ (late).pipeline.parse(text, { tokens: supplied(input) });
        assert.equal(oracle.ok, true, `late: ${oracle.error?.message}`);
        const expected = oracle.stages[1].output[0].props.has("K") === holds;
        const result = context.pipeline.parse(text, { tokens: supplied(input) });
        if (!result.ok) assert.equal(result.error.kind, "rejected", `${name} on ${JSON.stringify(input)}: ${result.error.message}`);
        assert.equal(result.ok, expected, `${name} on ${JSON.stringify(input)}`);
      }
    }
  });
}
