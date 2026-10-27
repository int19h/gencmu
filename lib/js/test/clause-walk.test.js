// Discovery reads executable clauses, not lowered body or source metadata.
import {test} from "node:test";
import assert from "node:assert/strict";
import {ParseContext} from "../src/earley.js";
import {loaderWith, runEngineCase} from "./shared.js";

test("parse discovery skips body links and condition metadata", () => {
  const loader = loaderWith({"main.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n%conditions $ ≅ #A\n```"});
  const pipeline = loader.pipeline("case/main.md");
  const lowered = pipeline.stages[0].grammar.lower(new Set());
  const production = lowered.productions.find(p => p.lhs === "text");
  assert.ok(production?.logicalSource);
  const unrelated = {enumerable: true, get() {throw new Error("discovery entered unrelated metadata");}};
  Object.defineProperty(production.logicalSource, "expr", unrelated);
  Object.defineProperty(production.conditions[0].condition, "diagnosticLocation", unrelated);
  const context = new ParseContext(lowered, [], [], loader.unicode);
  assert.ok(context.patterns, "the actual tree comparison still demands its pattern");
  assert.equal(context.closes, null);
});

for (const [name, grammar, tags, outputTags] of [
  ["boolean and presence conditions", "%rule text $x:A\n%conditions ¬($x ≇ #A), ($x ≅ #A ∧ $x ≅ #A) ∨ $x ≇ #A, ($x ⟹ $x ≅ #A)", ["A"], null],
  ["definition tags", "%rule text :: ($ ≅ #A ⟹ X)\n  | A", ["X"], null],
  ["alternative tags", "%rule text A :: ($ ≇ #B ⟹ X)", ["X"], null],
  ["emission tags", "%rule text A\n%emits $ :: ($ ≅ #A ⟹ X)", ["A"], ["X"]],
  ["deferred ranked conditions", "%rule text ($x:A ≻ B) :: ∅\n%conditions ($x ⟹ $x ≅ #A)", [], null],
]) {
  test(`pattern discovery keeps ${name} (engine §10)`, () => {
    const {json} = runEngineCase({grammar, tokens: [{text: "a", tags: ["A"]}]});
    assert.equal(json.ok, true);
    assert.deepEqual(json.tree.tags, tags);
    if (outputTags) assert.deepEqual(json.stages[0].output[0].tags, outputTags);
  });
}
