// The order of the first fault of a document (engine §9.3). Each entry of
// order-oracle.json is a pair of faults that one ordering rule decides: the
// first fault alone, the second fault alone, and both together. The reasons
// and sites come from the specification, not from either reader. The native
// reader and the transition compiler must both report each expected fault.
// Line 1 of each document is its opening fence.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createTransitionCompiler } from "../transition-compiler.js";
import { Loader50 } from "../../lib/js/src/format50/loader.js";
import { loaderForNotation } from "../../lib/js/src/node.js";

const oracle = JSON.parse(fs.readFileSync(new URL("./order-oracle.json", import.meta.url), "utf8"));
const compiler = createTransitionCompiler();
const loaders = loaderForNotation(50);
const library = new URL("../../lib/js/", import.meta.url);
/** @param {string[]} lines */
const fenced = lines => ["\x60\x60\x60jbogenbau", ...lines, "\x60\x60\x60", ""].join("\n");

// A bundled resource, such as a names file, comes from the package.
/** @param {string} path */
const bundled = path => {
  const file = new URL(path, library);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
};

const readers = {
  /** @param {any} input */
  native: input => input.documents ?
    loaders.loadPipelineSources(Object.fromEntries(Object.entries(input.documents)
      .map(([name, lines]) => [name, fenced(/** @type {string[]} */ (lines))])), "p.md") :
    new Loader50(path => path === "p.md" ? fenced(input.source) : bundled(path)).documentDom("p.md", undefined),
  /** @param {any} input */
  compiler: input => compiler.compileDocument(fenced(input.source), "p.md"),
};

/** @param {() => unknown} read */
function firstFault(read) {
  try {
    read();
  } catch (error) {
    return /** @type {any} */ (error);
  }
  return undefined;
}

for (const { rule, section, inputs, readers: names = ["native", "compiler"] } of oracle) {
  test(`${rule} (${section})`, () => {
    // Each pair names its two faults alone, then the input with both.
    assert.equal(inputs.length, 3);
    assert.ok(inputs.slice(0, 2).some((/** @type {any} */ alone) => alone.fault.reason === inputs[2].fault.reason));
    for (const { fault, ...input } of inputs) {
      for (const name of names) {
        const where = `${name} reader, ${JSON.stringify(input.source ?? input.documents)}`;
        const error = firstFault(() => readers[/** @type {"native" | "compiler"} */ (name)](input));
        assert.ok(error, `${where} loads`);
        const reason = String(error.description ?? error.message);
        assert.ok(reason.startsWith(fault.reason), `${where}: ${reason}`);
        assert.deepEqual([error.where?.line, error.where?.column], [fault.line, fault.column], `${where}: ${reason}`);
        if (fault.document) assert.equal(error.where?.document, fault.document, where);
      }
    }
  });
}

// Both readers convert on an explicit stack, so a document that nests deeper
// than the call stack reaches the depth limit of engine §9.3.
for (const [kind, line] of [
  ["list", "%const $D " + "[".repeat(3000) + '"x"' + "]".repeat(3000)],
  ["body", "%rule r " + "(A ".repeat(3000) + "B" + ")".repeat(3000)],
]) {
  test(`a ${kind} nested 3000 deep reports the depth limit`, () => {
    for (const name of /** @type {const} */ (["native", "compiler"])) {
      const error = firstFault(() => readers[name]({ source: [line] }));
      assert.equal(error?.description, "an expression, term or condition is nested more than 256 deep", `${name} reader`);
      assert.deepEqual([error.where.line, error.where.column], [2, 1]);
    }
  });
}
