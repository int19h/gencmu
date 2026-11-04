// A bootstrap of another notation gives the reader a tree of another
// shape (engine §9). Every library reads through a wrapper, and needs the
// parts of each rule that it knows. tests/notation-shapes.json holds the
// outcome that every library gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPipelineSources, GencmuError, toBrackets } from "../src/node.js";
import { findPlaces, substitute } from "./shared.js";
import { treeToDom } from "../src/reader.js";

const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const shapes = JSON.parse(fs.readFileSync(path.join(repository, "tests", "notation-shapes.json"), "utf8"));
const bootstrap = fs.readFileSync(path.join(repository, "data/preparsed/gencmu.json"), "utf8");
const syntaxAt = bootstrap.indexOf('"grammars/gencmu/jbogenbau/syntax.md":');
const names = JSON.parse(bootstrap).documents["grammars/gencmu/jbogenbau/syntax.md"].dom.rules.map(rule => rule.name).filter(name => name !== "text");

/**
 * Loads a document with a bootstrap, and parses each input: its brackets,
 * or the kind of its error. A load that fails gives the kind of its error.
 * Any error that is not a GencmuError fails the test.
 * @param {string} bootstrapText
 * @param {string} [document]
 * @param {string[]} [inputs]
 */
function outcome(bootstrapText, document = shapes.document, inputs = shapes.inputs, where = undefined) {
  let pipeline;
  try {
    pipeline = loadPipelineSources({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": document, "data/preparsed/gencmu.json": bootstrapText }, "p.md");
  } catch (error) {
    assert.ok(error instanceof GencmuError, `an error that is not a GencmuError: ${error}`);
    // Where the item gives it, the place of the error in its document.
    if (where) assert.deepEqual({ document: error.where.document, line: error.where.line, column: error.where.column }, where, error.message);
    return error.kind;
  }
  assert.equal(where, undefined, "the document loaded, but the item gives where its error stands");
  return inputs.map((input) => {
    const result = pipeline.parse(input);
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
    for (const name of names) {
      for (const field of ["ref","rule"]) changed = changed.split(`"${field}":"${name}"`).join(`"${field}":"${name}-wrapper"`);
    }
    const wrappers = names.map((name, index) =>
      `{"name":"${name}-wrapper","op":"define","alternatives":[{"guards":[],"expr":{"ref":"${name}"}}],"conditions":[],"at":[${100000 + index},1]},`).join("");
    return changed.replace('"rules":[', `"rules":[${wrappers}`);
  });
  assert.deepEqual(outcome(wrapped), shapes.control);
});

test("each renamed rule of the notation gives the outcome of every library", () => {
  for (const name of names) {
    const renamed = withSyntax((syntax) => {
      syntax = syntax.split(`"name":"${name}","op"`).join(`"name":"${name}x","op"`);
      for (const field of ["ref","rule"]) syntax = syntax.split(`"${field}":"${name}"`).join(`"${field}":"${name}x"`);
      return syntax;
    });
    assert.deepEqual(outcome(renamed), shapes.loads[name] ?? "grammar", name);
  }
  for (const name of Object.keys(shapes.loads)) assert.ok(names.includes(name), name);
});

test("a part that the reader does not read is ignored in every library", () => {
  for (const item of shapes.extraParts) {
    // One substitution, or several applied in order (tests/README.md).
    const finds = Array.isArray(item.find) ? item.find : [item.find];
    const replaces = Array.isArray(item.replace) ? item.replace : [item.replace];
    let changed = bootstrap;
    finds.forEach((find, index) => {
      assert.equal(findPlaces(changed, find).length, 1, item.description);
      changed = substitute(changed, find, replaces[index]);
    });
    assert.deepEqual(outcome(changed, item.document, item.inputs, item.where), item.expect, item.description);
  }
});

// Each notation stage runs the check of elision-only where its own
// directive declares it (engine §8). With greedy and elision-only on the
// lexical stage, the check finds the ambiguity that greedy settled in
// `...`, which is also `..` and `.`, and the document does not load.
test("a notation stage that declares elision-only runs the check", () => {
  const ordinary = JSON.parse(bootstrap);
  ordinary.documents["grammars/gencmu/jbogenbau/lexical.md"].dom.rules
    .find(rule => rule.name === "symbol").alternatives.push({guards: [], expr: {literal: {string: "."}}});
  const elision = structuredClone(ordinary);
  const lexical = elision.documents["grammars/gencmu/jbogenbau/lexical.md"].dom;
  const directive = lexical.directives.find((item) => item.name === "ambiguity-resolution");
  assert.deepEqual(directive.steps, [{ step: "greedy" }]);
  lexical.directives.push({ name: "elision-only", args: [], at: [directive.at[0], directive.at[1] + 40] });
  const sources = (bootstrapText) => ({ "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {...B}\n```\n", "data/preparsed/gencmu.json": bootstrapText });
  // The bundled bootstrap loads the same documents.
  loadPipelineSources(sources(JSON.stringify(ordinary)), "p.md");
  assert.throws(() => loadPipelineSources(sources(JSON.stringify(elision)), "p.md"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && error.where.document === "g.md" && error.where.line === undefined && /lexical stage of the notation/.test(error.message));
});


test("supplied node positions search past empty wrappers and retain input boundaries", () => {
  const tokens = [{value:"a", source:[0,1]}, {value:"b", source:[5,6]}];
  const token = {kind:"token", token:1, span:[1,2]};
  const padding = {kind:"rule", rule:"padding", span:[0,0], children:[]};
  for (const [children, span, column] of [[[padding, token],[0,2],6], [[],[1,1],6], [[],[2,2],7]]) {
    const item = {kind:"rule", rule:"capture", span, children};
    const root = {kind:"rule", rule:"text", span:[0,2], children:[item]};
    assert.throws(() => treeToDom(root,tokens,t => [1,t.source[0]+1],"g.md",{},() => ""),
      error => error instanceof GencmuError && error.where.column === column);
  }
});

test("elided root parts do not precede a names declaration", () => {
  const root = {kind:"rule", rule:"text", span:[0,1], children:[
    {kind:"elided", terminal:"X", span:[0,0]},
    {kind:"rule", rule:"directive", span:[0,1], children:[{kind:"token", token:0, span:[0,1]}]},
  ]};
  assert.throws(() => treeToDom(root,[{value:"%names",source:[0,6]}],() => [1,1],"g.md",{},() => ""),
    error => error instanceof GencmuError && !error.message.includes("must precede"));
});
