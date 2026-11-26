// Format 50 load checks: the provenance of stored engine memberships, and
// the names fingerprints of a cache entry.
import test from "node:test";
import assert from "node:assert/strict";
import { fnv1a64 } from "../src/hash.js";
import { Loader50 } from "../src/format50/loader.js";
import { loaderForNotation } from "../src/node.js";
import { readFileSync } from "node:fs";

const loaders = loaderForNotation(50);
/** @param {string[]} lines */
const pipelineOf = lines => loaders.loadPipelineSources({ "p.md": ["```jbogenbau", "%stage main", "%ambiguity-resolution greedy", ...lines, "```", ""].join("\n") }, "p.md");
const PERMISSION = /a permission set such as \$INPUTS cannot supply stored engine memberships/;

test("a stored engine membership needs evidence from a node, through every route of a value", () => {
  /** @type {[string, string[]][]} */
  const refused = [
    ["a splat of $OUTPUTS made from $INPUTS", ["%const $OUTPUTS {*$INPUTS}", "%rule text {w}", "%rule w A → {*$OUTPUTS}", "%emit"]],
    ["a splat of an alias", ["%const $P $INPUTS", "%rule text {w}", "%rule w A → {*$P}", "%emit"]],
    ["a splat of a function", ["%const $F $n ↦ $INPUTS", "%rule text {w}", "%rule w $a:A → {*$F($a)}", "%emit"]],
    ["a splat of a selection of $INPUTS", ["%rule text {w}", "%rule w A → {*$INPUTS.select({A})}", "%emit"]],
    ["a splat of a later version", ["%const $P {B}", "%redefine-const $P {*$P, *$INPUTS}", "%rule text {w}", "%rule w A → {*$P}", "%emit"]],
    ["a splat of a union", ["%const $P {B}", "%rule text {w}", "%rule w A → {*($P ∪ $INPUTS)}", "%emit"]],
    ["a splat of a constant that names an engine key", ["%const $P {_Script_Latin}", "%rule text {w}", "%rule w A → {*$P}", "%emit"]],
    ["a copy from $INPUTS", ["%rule text {w}", "%rule w A → {$INPUTS'_Script_Latin}", "%emit"]],
    ["a copy from an alias", ["%const $P $INPUTS", "%rule text {w}", "%rule w A → {$P'_Script_Latin}", "%emit"]],
    ["the stage defaults", ["%const $DEFAULTS $n ↦ {*$INPUTS}", "%rule text {w}", "%rule w A", "%emit"]],
    ["the stage defaults through an alias", ["%const $P $INPUTS", "%const $DEFAULTS $n ↦ {*$P}", "%rule text {w}", "%rule w A", "%emit"]],
    ["a braced item", ["%rule text $a:A", "%emit $a{*$INPUTS}"]],
    ["a braced item through an alias", ["%const $P $INPUTS", "%rule text $a:A", "%emit $a{*$P}"]],
    ["a braced item over the node", ["%rule text A", "%emit ${*$INPUTS}"]],
    ["an insertion", ["%rule text A", "%emit ε{value: \"x\", image: \"x\", *$INPUTS}"]],
    ["a copy in a braced item", ["%rule text $a:A", "%emit $a{$INPUTS'_Script_Latin}"]],
  ];
  for (const [name, lines] of refused) assert.throws(() => pipelineOf(lines), PERMISSION, name);
  assert.throws(() => pipelineOf(["%const $DEFAULTS $n ↦ {_Script_Latin}", "%rule text {w}", "%rule w A", "%emit"]),
    /a constructor cannot write the engine key _Script_Latin/);
  // A template argument cannot carry $INPUTS into recognition.
  assert.throws(() => pipelineOf(["%rule t(@P) A → {*@P}", "%emit", "%rule text t($INPUTS)"]),
    /cannot yet read \$INPUTS, which the engine gives to the stage after recognition/);
  // A node is evidence, and a mask can name an engine key for its selection.
  for (const lines of [
    ["%rule text {w}", "%rule w $a:A → {*$a.select({A, _Script_Latin})}", "%emit"],
    ["%rule text {w}", "%rule w $a:A → {*$a.select($INPUTS)}", "%emit"],
    ["%rule text {w}", "%rule w $a:A → {*$a}", "%emit"],
    ["%const $OUTPUTS {*$INPUTS}", "%rule text {w}", "%rule w $a:A → {*$a.flags}", "%emit"],
    ["%rule text {w}", "%rule w $a:A → {$a'_Script_Latin}", "%emit"],
    ["%rule text $a:A", "%emit $a{*$a.select({_Script_Latin})}"],
  ]) assert.doesNotThrow(() => pipelineOf(lines), lines.join(" / "));
});

test("a cache entry made with other names resources is a miss", () => {
  const path = "grammars50/fam/pipeline.md";
  const names = "grammars50/fam/names.txt";
  const document = ["```jbogenbau", '%names "names.txt"', "%stage main", "%ambiguity-resolution greedy", '%rule text "‹TEST PRIVATE SCALAR›"', "```", ""].join("\n");
  const first = "unicode-names 15.1.0\nname E000 TEST PRIVATE SCALAR\n";
  const second = "unicode-names 15.1.0\nname E001 TEST PRIVATE SCALAR\n";
  /** @param {Map<string, string>} files */
  const loaderOver = files => new Loader50(file => files.has(file) ? files.get(file) : readBundled(file), file => files.has(file));
  // The entry that a loader with the first resource writes.
  const writer = loaderOver(new Map([[path, document], [names, first]]));
  const entry = writer.readDocument(document, path, []);
  assert.ok(entry.names, "the entry records its names dependency");
  const cache = JSON.stringify({
    format: 50, bootstrap: writer.bootstrapHash, unicode: writer.unicodeHash, properties: writer.propertiesHash,
    bundledNames: {}, documents: { [path]: entry },
  });
  for (const [resource, scalar, hit] of [[first, "", true], [second, "", false]]) {
    const loader = loaderOver(new Map([[path, document], [names, resource], ["data/preparsed50/fam.json", cache]]));
    const pipeline = loader.pipeline(path);
    assert.equal(loader.cacheHits.includes(path), hit, `a hit with ${JSON.stringify(scalar)}`);
    assert.equal(pipeline.parse(scalar).ok, true, `the text ${JSON.stringify(scalar)} parses`);
  }
  assert.equal(fnv1a64(first) === fnv1a64(second), false);
});

/** @type {Map<string, string | undefined>} */
const bundledTexts = new Map();

/**
 * A file of this package, as the bundled loader reads it.
 * @param {string} file
 */
function readBundled(file) {
  if (!bundledTexts.has(file)) {
    const relative = file === "data/unicode/unicode-names-reference.txt" ? "data/unicode/unicode-names.txt" : file;
    let text;
    try {
      text = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    } catch {
      text = undefined;
    }
    bundledTexts.set(file, text);
  }
  return bundledTexts.get(file);
}
