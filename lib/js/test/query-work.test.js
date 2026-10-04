// The shared cases of tests/query-work.json: a step or a term that starts
// many queries evaluates each part of its conditions and terms a bounded
// number of times (tests/README.md, "Query work cases"). The visits are
// counted, not timed, and the budget stops the parse at the first visit
// past it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository } from "./shared.js";
import { countedWork } from "./linear.js";
import { loadDialectSources } from "../src/node.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "query-work.json"), "utf8"));

/**
 * The grammar of a case, with `{i}` in its item and its rule standing for
 * each i from 0 to its count less one.
 * @param {any} testCase
 * @returns {string}
 */
function grammarOf(testCase) {
  const each = (/** @type {string} */ pattern) => Array.from({ length: testCase.count }, (_, i) => pattern.split("{i}").join(String(i)));
  return testCase.head + each(testCase.item).join(testCase.joiner) + testCase.tail + each(testCase.rule).join("");
}

test("many queries in one step or one term evaluate each part a bounded number of times (tests/query-work.json)", () => {
  assert.ok(cases.length > 0);
  for (const testCase of cases) {
    // Loading reads the grammar's own conditions and terms, which counts no
    // visit of a parse, so it comes before the count.
    const dialect = loadDialectSources({
      "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
      "g.md": "# A grammar\n\n```jbogenbau\n" + grammarOf(testCase) + "\n```\n",
    }, "p.md");
    /** @type {any} */
    let result;
    const work = countedWork(() => {
      result = dialect.parse(testCase.text, { autoFeatures: false });
    }, { visits: testCase.most * testCase.count });
    assert.equal(result.ok, true, `${testCase.name}: the parse failed`);
    assert.ok(work.visits > 0, `${testCase.name}: no visit counted`);
  }
});

/**
 * The dialect whose one stage is `grammar`, reading the text's characters.
 * @param {string} grammar
 */
function single(grammar) {
  return loadDialectSources({
    "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n" + grammar + "\n```\n",
  }, "p.md");
}

test("a span inside many functions visits each of them once", () => {
  // text(head(head(… $c …))) n deep. A function that found its argument's
  // span twice would visit the capture 2ⁿ times.
  for (const depth of [10, 40]) {
    const span = "head(".repeat(depth) + "$c" + ")".repeat(depth);
    const dialect = single(`%rule text $c('a')\n%conditions text(${span}) = "a"`);
    /** @type {any} */
    let result;
    // Each head once, and six visits for the rest of the condition.
    const work = countedWork(() => {
      result = dialect.parse("a", { autoFeatures: false });
    }, { visits: depth + 6 });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(work.visits, depth + 6);
  }
});

test("each kind of compound part goes on from where a nested query halted it", () => {
  // Every query is unanswered when first asked, so each halts its step.
  // The queries stand inside each kind of compound part: a union, an
  // intersection, a difference, an implication, a negation, a conjunction,
  // a disjunction and a comparison. The tag term of `$` halts inside the
  // conditions that read it. A part that lost what it had, or evaluated a
  // part again, would give other tags or other visits.
  const queries = (/** @type {string} */ rule) => `tags(after($), ${rule})`;
  const grammar = [
    `%rule text 'a' <((${queries("p")} ∪ ${queries("q")}) ∩ (${queries("q")} ∪ ${queries("r")})) ∪ (${queries("p")} ∖ ${queries("q")}) ∪ (matches(after($), e) ⟹ ${queries("t")})>`,
    "%conditions ¬matches(after($), z) ∧ (matches(after($), z) ∨ matches(after($), e)), matches(after($), z) ⟹ ¬matches(after($), e),",
    "  tags($) = P ∪ Q ∪ T, classes($) ⊆ P ∪ Q ∪ T",
    "%emits $ <(tags($, p2) ∪ tags($, q2)) ∩ (tags($, q2) ∪ tags($, r2))>",
    "%rule p ε <P>", "%rule q ε <Q>", "%rule r ε <R>", "%rule t ε <T>", "%rule e ε", "%rule z 'b'",
    "%rule p2 'a' <P>", "%rule q2 'a' <Q>", "%rule r2 'a' <R>",
  ].join("\n");
  const dialect = single(grammar);
  /** @type {any} */
  let result;
  const work = countedWork(() => {
    result = dialect.parse("a", { autoFeatures: false });
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual([...result.stages[0].tree.tags].sort(), ["P", "Q", "T"]);
  assert.deepEqual([...result.stages[0].output[0].tags].sort(), ["Q"]);
  // Each node of the conditions and the terms counts once, its spans
  // included. The tag term has 30, and the conditions 30, since an
  // implication whose antecedent fails skips its consequent. The emission
  // has 11, and each of the 7 tag terms of the nested parses has one.
  assert.equal(work.visits, 30 + 30 + 11 + 7);
});
