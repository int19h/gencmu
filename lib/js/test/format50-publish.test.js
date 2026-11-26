// Format 50 publication: the covers of an emission list, the faces of the
// satellites, and the shared cases that show them.
import test from "node:test";
import assert from "node:assert/strict";
import { loaderForNotation } from "../src/node.js";
import { runSharedOutcome, sharedOutcome } from "./shared50.js";

const loaders = loaderForNotation(50);
/** @param {string[]} lines */
const pipelineOf = lines => loaders.loadPipelineSources({ "p.md": ["```jbogenbau", "%stage main", "%ambiguity-resolution greedy",
  "%const $OUTPUTS {A, B}", ...lines, "```", ""].join("\n") }, "p.md");

test("the unguarded covers of an emission list are disjoint and in input order (docs/notation.md, \"Emission\")", () => {
  // Two covers of one part.
  assert.throws(() => pipelineOf(["%rule text $x:A", '%emit $x{}, ε{image: value: "i"}, $x{}']), /covers input that another of its items covers/);
  // A cover of the node and a cover of its part.
  assert.throws(() => pipelineOf(["%rule text $a:A $b:B", '%emit ${image: value: "w"}, ε{image: value: "i"}, $b{}']), /covers input that another of its items covers/);
  assert.throws(() => pipelineOf(["%rule text $a:A $b:B", "%emit $b{}, $a{}"]), /out of the input order of their parts/);
  // A part that a route does not bind gives no token there.
  const pipeline = pipelineOf(["%rule text", "  | $x:A", "  | B", "%emit $x{}"]);
  const result = pipeline.parse("b", { tokens: [{ text: "b", props: { B: true } }].map((token, index) => ({ ...token, span: [index, index + 1], source: [0, 1] })) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.stages[0].output, []);
  // Guarded covers wait for the check of the actual output.
  assert.doesNotThrow(() => pipelineOf(["%rule text $x:A", "%emit $x{}, $.starts-input ? $x{}"]));
});

test("the shared cases of covers and satellites give the answers of the reference", () => {
  for (const id of ["engine/capture-name-order-per-production.json", "notation/emit-capture-twice.json", "notation/emit-order.json",
    // A satellite branch with an emission list shows the units of its list,
    // and a failing recipe there fails the publication (engine §11.3).
    "engine/attach-error-in-attachment.json", "engine/quote-attachments-bpfk-laho.json",
    // A case with several parses checks each parse against its own reference.
    "engine/stage-features-bundled-conflict.json",
    // Display reads no face that it does not show, so an overridden image
    // makes no verbatim claim.
    "engine/values-verbatim-overridden.json",
    // A message cannot read a private binding of a ranked option.
    "engine/i276-message-private.json"]) {
    const [family, file] = id.split("/");
    assert.deepEqual(runSharedOutcome(sharedOutcome(family, file)), { status: "pass", detail: "" }, id);
  }
});
