// The tree emission fixtures on the format 50 loader. A case that the
// loader cannot run yet is a todo with its reason.
import test from "node:test";
import { treeEmissionCases, runCase, transparencyCase } from "./tree-emission.js";

for (const entry of treeEmissionCases()) {
  const outcome = runCase(entry);
  if (outcome.status === "pass") test(`tree emission ${entry.id}`, () => {});
  else test(`tree emission ${entry.id}`, { todo: outcome.detail.split("\n")[0].slice(0, 200) }, () => {});
  // A compound label is transparent to the parse (erratum M-60).
  const same = entry.id.startsWith("m60-") ? transparencyCase(entry) : null;
  if (same?.status === "pass") test(`transparency ${entry.id}`, () => {});
  else if (same) test(`transparency ${entry.id}`, { todo: same.detail.slice(0, 200) }, () => {});
}

test("loaderForNotation selects notation 50 and refuses other versions", async () => {
  const assert = (await import("node:assert/strict")).default;
  const { loaderForNotation } = await import("../src/node.js");
  const loaders = loaderForNotation(50);
  // The bundle holds each pipeline whose document the package's grammars50
  // directory holds, the notation among them.
  const fs = await import("node:fs");
  const directory = new URL("../grammars50/", import.meta.url);
  const written = fs.readdirSync(directory, { recursive: true }).map(String)
    .filter(file => file.endsWith("/pipeline.md")).map(file => file.slice(0, -"/pipeline.md".length).split("\\").join("/")).sort();
  assert.deepEqual(loaders.bundledPipelines(), written);
  assert.ok(written.includes("gencmu/jbogenbau"));
  const pipeline = loaders.loadPipelineSources({
    "x/pipeline.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%const $OUTPUTS {}\n%rule text \"a\"\n%emit\n```\n",
  }, "x/pipeline.md");
  const record = JSON.parse(loaders.resultJson(pipeline.parse("a")));
  assert.equal(record.format, 18);
  assert.deepEqual(record.stages[0].output[0].props, { image: "a", value: "a" });
  assert.throws(() => loaderForNotation(49), error => error.kind === "usage");
});
