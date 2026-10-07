// A grammar document read from disk is strict UTF-8 (engine §1): bytes that
// do not decode are a grammar error of that document, with no line or
// column, found before any hash or compiled DOM.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDialectFile, loaderFromDirectory, GencmuError, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT } from "../src/dom.js";
import { grammars } from "./shared.js";

const PIPELINE = "# A dialect\n\n```jbogenbau\n%stage main\n%include \"g.md\"\n```\n";
const grammar = (rule) => "# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n" + rule + "\n```\n";

// A directory holding the documents, each a string or bytes.
const roots = [];
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
function directory(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-utf8-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

// A document's text with bytes spliced in at a marker.
const withBytes = (text, bytes) => {
  const [head, tail] = text.split("@");
  return Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(bytes), Buffer.from(tail, "utf8")]);
};

// Invalid bytes: a stray continuation, a truncated sequence, an overlong
// form, an encoded surrogate and a value above U+10FFFF.
const INVALID = [[0x80], [0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff]];

test("invalid bytes in a document on disk are a grammar error of that document", () => {
  const places = [
    ["the pipeline's prose", (bytes) => ({ "p.md": withBytes("# A dialect @\n\n" + PIPELINE, bytes), "g.md": grammar("%rule text 'a'") }), "p.md"],
    ["a comment of the pipeline", (bytes) => ({ "p.md": withBytes(PIPELINE.replace("%stage main", "%stage main (* @ *)"), bytes), "g.md": grammar("%rule text 'a'") }), "p.md"],
    ["an included document's prose", (bytes) => ({ "p.md": PIPELINE, "g.md": withBytes("# A grammar @\n\n" + grammar("%rule text 'a'"), bytes) }), "g.md"],
    ["a comment of an included document", (bytes) => ({ "p.md": PIPELINE, "g.md": withBytes(grammar("%rule text 'a' (* @ *)"), bytes) }), "g.md"],
  ];
  for (const [place, files, bad] of places) {
    for (const bytes of INVALID) {
      const root = directory(files(bytes));
      assert.throws(() => loadDialectFile(path.join(root, "p.md")), (error) => {
        assert.ok(error instanceof GencmuError, String(error));
        assert.equal(error.kind, "grammar", `${place}: ${error.message}`);
        assert.equal(error.where.document, path.resolve(root, bad).split(path.sep).join("/"), place);
        assert.match(error.message, /not valid UTF-8/);
        assert.equal(error.where.line, undefined);
        assert.equal(error.where.column, undefined);
        return true;
      }, `${place}: ${Buffer.from(bytes).toString("hex")}`);
    }
  }
});

test("a document that does not decode is refused before its compiled DOM is consulted", () => {
  // compiled.json holds an entry for the text a lossy decoding would give.
  const bytes = withBytes("# A grammar @\n\n" + grammar("%rule text 'a'"), [0xff]);
  const lossy = bytes.toString("utf8");
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", flags: [], alternatives: [{ guards: [], expr: { terminal: "'a'" } }], conditions: [], at: [6, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [5, 1] }], constants: [], classifiers: [], implications: [] };
  const bootstrap = fs.readFileSync(path.join(grammars, "notation", "bootstrap.json"), "utf8");
  const compiled = { format: DOM_FORMAT, bootstrap: fnv1a64(bootstrap), documents: { "g.md": { hash: fnv1a64(lossy), dom } } };
  const files = {
    "p.md": PIPELINE,
    "unicode.txt": fs.readFileSync(path.join(grammars, "unicode.txt")),
    "notation/bootstrap.json": bootstrap,
  };
  // The control: the entry is used for the text it names.
  const good = directory({ ...files, "g.md": lossy, "compiled.json": JSON.stringify(compiled) });
  const loader = loaderFromDirectory(good);
  assert.equal(loader.compiled.size, 1);
  assert.ok(loader.dialect("p.md").parse("a", { autoFeatures: false }).ok);
  const bad = directory({ ...files, "g.md": bytes, "compiled.json": JSON.stringify(compiled) });
  assert.throws(() => loaderFromDirectory(bad).dialect("p.md"), (error) => error instanceof GencmuError && error.kind === "grammar" && error.where.document === "g.md");
});

test("U+FFFD, supplementary characters and a byte order mark decode as themselves", () => {
  const root = directory({
    "p.md": "# A dialect \u{FFFD} \u{1F600}\n\n" + PIPELINE,
    "g.md": grammar("%rule text '\u{FFFD}' '\u{1F600}' '\u{10FFFD}' (* \u{FFFD} \u{1F600} *)"),
  });
  const dialect = loadDialectFile(path.join(root, "p.md"));
  assert.ok(dialect.parse("\u{FFFD}\u{1F600}\u{10FFFD}", { autoFeatures: false }).ok);
  assert.ok(!dialect.parse("\u{FFFD}\u{1F600}", { autoFeatures: false }).ok);
  // A byte order mark stays U+FEFF, so a fence after it opens no block.
  const marked = directory({ "p.md": "\u{FEFF}" + PIPELINE.slice(PIPELINE.indexOf("```")), "g.md": grammar("%rule text 'a'") });
  assert.throws(() => loadDialectFile(path.join(marked, "p.md")), (error) => error instanceof GencmuError && /at least one %stage/.test(error.message));
  const prose = directory({ "p.md": "\u{FEFF}" + PIPELINE, "g.md": grammar("%rule text '\u{FEFF}'") });
  assert.ok(loadDialectFile(path.join(prose, "p.md")).parse("\u{FEFF}", { autoFeatures: false }).ok);
});

test("a compiled.json that does not decode is a cache miss, and valid documents still load", () => {
  const files = {
    "p.md": PIPELINE,
    "g.md": grammar("%rule text 'a'"),
    "unicode.txt": fs.readFileSync(path.join(grammars, "unicode.txt")),
    "notation/bootstrap.json": fs.readFileSync(path.join(grammars, "notation", "bootstrap.json")),
  };
  for (const cache of [Buffer.from([0xff]), withBytes('{"format":10,"documents":{"@":{}}}', [0xff])]) {
    const loader = loaderFromDirectory(directory({ ...files, "compiled.json": cache }));
    assert.equal(loader.compiled.size, 0);
    assert.ok(loader.dialect("p.md").parse("a", { autoFeatures: false }).ok);
  }
  // A required resource that does not decode is still an error.
  const broken = directory({ ...files, "unicode.txt": withBytes("unicode 15.1.0 @\n", [0xff]) });
  assert.throws(() => loaderFromDirectory(broken), (error) => error instanceof GencmuError && error.kind === "grammar" && error.where.document === "unicode.txt");
});
