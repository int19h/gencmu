// Format 50 recognition gives the answer of the stage, or a clear load
// error, on the forms of format50-exactness-cases.json. Each case gives its
// documents, its text and the answer that the spec gives: an accepted text,
// an error of the parse, a usage error, or a load error with its message.
// The oracle checks each accepted text on the real bags too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loaderForNotation } from "../src/node.js";
import { withOracle, oracleProblems } from "./oracle.js";

const cases = JSON.parse(readFileSync(new URL("./format50-exactness-cases.json", import.meta.url), "utf8"));
const loaders = loaderForNotation(50);

/**
 * The outcome of a case in the form of its expectation.
 * @param {any} item
 */
function outcomeOf(item) {
  let pipeline;
  try {
    pipeline = loaders.loadPipelineSources(item.sources, "p.md");
  } catch (error) {
    return { load: /** @type {Error} */ (error).message.slice(0, 90) };
  }
  try {
    const { value, checks } = withOracle(() => item.options ? pipeline.parse(item.input, item.options) : pipeline.parse(item.input));
    const problems = oracleProblems(checks);
    if (problems.length) return { oracle: problems };
    return value.ok ? { ok: true } : { error: value.error.kind, message: value.error.message.slice(0, 70) };
  } catch (error) {
    return { usage: /** @type {Error} */ (error).message.slice(0, 70) };
  }
}

for (const item of cases) {
  test(`the form ${item.name} gives the answer of the spec`, () => {
    assert.deepEqual(outcomeOf(item), item.outcome);
  });
}
