import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPipeline } from "../src/node.js";

const text = "mi broda gi'e to do toi to di toi ke brode ke'e vau";
function nodes(tree) {
  return [tree, ...(tree.children || []).flatMap(nodes)];
}
for (const name of ["lojban/cll", "lojban/experimental"]) {
  test(`${name} keeps two free modifiers before the KE tail`, () => {
    const result = loadPipeline(name).parse(text);
    assert.equal(result.ok, true);
    assert.equal(result.stages.at(-1).verdict, name === "lojban/cll" ? "resolved" : "unique");
    const all = nodes(result.tree);
    const slot = all.find(node => node.rule === "🆓"
      && text.slice(...node.source) === "to do toi to di toi");
    assert.ok(slot);
    assert.deepEqual(slot.children.map(node => node.rule), ["free", "free"]);
    if (name === "lojban/cll") {
      const connection = all.find(node => node.rule === "bridi-tail-1"
        && node.children.some(child => child.rule === "gihek"));
      assert.deepEqual(connection.children.map(node => node.rule),
        ["bridi-tail-1", "gihek", "🆓", "bridi-tail-2", "tail-terms"]);
    } else {
      const group = all.find(node => node.rule === "main-bridi-tail"
        && node.children.some(child => child.terminal === "KE"));
      assert.ok(group);
    }
  });
}
