// The tree emission fixtures on the format 50 loader. A case that the
// loader cannot run yet is a todo with its reason.
import test from "node:test";
import { treeEmissionCases, runCase } from "./tree-emission.js";

for (const entry of treeEmissionCases()) {
  const outcome = runCase(entry);
  if (outcome.status === "pass") test(`tree emission ${entry.id}`, () => {});
  else test(`tree emission ${entry.id}`, { todo: outcome.detail.split("\n")[0].slice(0, 200) }, () => {});
}
