// A bootstrap of another notation gives the reader a tree of another
// shape (engine §9). Every library reads through a wrapper, and needs the
// parts of each rule that it knows. tests/notation-shapes.json holds the
// outcome that every library gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDialectSources, GencmuError, toBrackets } from "../src/node.js";

const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const shapes = JSON.parse(fs.readFileSync(path.join(repository, "tests", "notation-shapes.json"), "utf8"));
const bootstrap = fs.readFileSync(path.join(repository, "grammars", "notation", "bootstrap.json"), "utf8");
const syntaxAt = bootstrap.indexOf('"path":"notation/syntax.md"');
const names = JSON.parse(bootstrap).stages.flatMap((stage) => stage.documents).find((document) => document.path === "notation/syntax.md")
  .dom.rules.map((rule) => rule.name).filter((name) => name !== "text");

/**
 * Loads a document with a bootstrap, and parses each input: its brackets,
 * or the kind of its error. A load that fails gives the kind of its error.
 * Any error that is not a GencmuError fails the test.
 * @param {string} bootstrapText
 * @param {string} [document]
 * @param {string[]} [inputs]
 */
function outcome(bootstrapText, document = shapes.document, inputs = shapes.inputs) {
  let dialect;
  try {
    dialect = loadDialectSources({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": document, "notation/bootstrap.json": bootstrapText }, "p.md");
  } catch (error) {
    assert.ok(error instanceof GencmuError, `an error that is not a GencmuError: ${error}`);
    return error.kind;
  }
  return inputs.map((input) => {
    const result = dialect.parse(input);
    return result.ok ? toBrackets(result) : /** @type {import("../src/types.js").ParseError} */ (result.error).kind;
  });
}

/**
 * The bundled bootstrap with `change` made to its syntax document only.
 * @param {(syntax: string) => string} change
 */
function withSyntax(change) {
  return bootstrap.slice(0, syntaxAt) + change(bootstrap.slice(syntaxAt));
}

test("the bundled bootstrap gives the control", () => {
  assert.deepEqual(outcome(bootstrap), shapes.control);
});

test("a wrapper around each rule of the notation changes nothing", () => {
  const wrapped = withSyntax((syntax) => {
    let changed = syntax;
    for (const name of names) changed = changed.split(`{"ref":"${name}"}`).join(`{"ref":"${name}-wrapper"}`);
    const wrappers = names.map((name, index) =>
      `{"name":"${name}-wrapper","op":"define","alternatives":[{"guards":[],"expr":{"ref":"${name}"}}],"conditions":[],"at":[${100000 + index},1]},`).join("");
    return changed.replace('"rules":[', `"rules":[${wrappers}`);
  });
  assert.deepEqual(outcome(wrapped), shapes.control);
});

test("each renamed rule of the notation gives the outcome of every library", () => {
  for (const name of names) {
    const renamed = withSyntax((syntax) => syntax.split(`"name":"${name}","op"`).join(`"name":"${name}x","op"`).split(`{"ref":"${name}"}`).join(`{"ref":"${name}x"}`));
    assert.deepEqual(outcome(renamed), shapes.loads[name] ?? "grammar", name);
  }
  for (const name of Object.keys(shapes.loads)) assert.ok(names.includes(name), name);
});

test("a part that the reader does not read is ignored in every library", () => {
  for (const item of shapes.extraParts) {
    const changed = withSyntax((syntax) => {
      assert.equal(syntax.split(item.find).length, 2, item.description);
      return syntax.replace(item.find, item.replace);
    });
    assert.deepEqual(outcome(changed, item.document, item.inputs), item.expect, item.description);
  }
});

// Each notation stage runs the check of elision-only where its own
// directive declares it (engine §8). With greedy and elision-only on the
// lexical stage, the check finds the ambiguity that greedy settled in the
// pipeline document itself, and the document does not load.
test("a notation stage that declares elision-only runs the check", () => {
  const elision = JSON.parse(bootstrap);
  const lexical = elision.stages.find((stage) => stage.name === "lexical");
  const directive = lexical.documents.flatMap((document) => document.dom.directives).find((item) => item.name === "ambiguity-resolution");
  assert.deepEqual(directive.args, ["greedy"]);
  directive.args = ["greedy", "elision-only"];
  const sources = (bootstrapText) => ({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A B\n```\n", "notation/bootstrap.json": bootstrapText });
  // The bundled bootstrap loads the same documents.
  loadDialectSources(sources(bootstrap), "p.md");
  assert.throws(() => loadDialectSources(sources(JSON.stringify(elision)), "p.md"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && error.where.document === "p.md" && error.where.line === undefined && /lexical stage of the notation/.test(error.message));
});

test("a repetition's markers are refused at the token that the specification names, whichever a reader meets first (engine §9)", () => {
  // The second marker, or the marker after the separator, of the items of
  // extraParts that refuse their document.
  const expected = { "Two markers": [3, 21], "Three markers": [3, 16], "A marker after the second": [3, 23] };
  for (const [start, [line, column]] of Object.entries(expected)) {
    const item = shapes.extraParts.find((part) => part.description.startsWith(start));
    assert.ok(item, start);
    const changed = withSyntax((syntax) => syntax.replace(item.find, item.replace));
    assert.throws(() => loadDialectSources({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": item.document, "notation/bootstrap.json": changed }, "p.md"),
      (error) => error instanceof GencmuError && error.where.document === "g.md" && error.where.line === line && error.where.column === column, start);
  }
});
