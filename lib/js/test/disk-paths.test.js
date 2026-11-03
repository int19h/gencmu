// A pipeline loaded from disk knows each document by its absolute path, so
// an error names the file the same way from any working directory, and in
// every library.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import { loadPipelineFile, loadPipelineSources, GencmuError } from "../src/node.js";
import { splicePipeline } from "../src/splice.js";

test("include relocation keeps structured error fields", () => {
  const top = {format:43, rules:[], constants:[], classifiers:[], implications:[], directives:[
    {name:"stage", args:["main"], at:[1,1]},
    {name:"include", args:["g.md"], at:[2,1]},
  ]};
  for (const line of [undefined, 7]) {
    const cause = new Error("disk");
    const original = new GencmuError("grammar", "read failure", {document:"g.md", line, code:"sentinel"}, {cause});
    assert.throws(() => splicePipeline("p.md", path => {
      if (path === "p.md") return top;
      throw original;
    }), error => {
      assert.equal(error.code, "sentinel");
      assert.equal(error.where.stage, "main");
      assert.equal(error.cause, cause);
      assert.equal(error.where.document, line === undefined ? "p.md" : "g.md");
      assert.equal(error.where.line, line === undefined ? 2 : 7);
      assert.equal(original.where.document, "g.md");
      return true;
    });
  }
});

const roots = [];
const home = process.cwd();
after(() => {
  process.chdir(home);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
/** @type {(files: Record<string, string>) => string} */
function directory(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-paths-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}
const slashed = (file) => path.resolve(file).split(path.sep).join("/");

test("an error in a pipeline or an included document names its absolute path, from another working directory", () => {
  const included = directory({
    "p.md": "```jbogenbau\n%stage main\n%include \"sub/g.md\"\n```\n",
    "sub/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (\n```\n",
  });
  const pipeline = directory({ "p.md": "```jbogenbau\n%stage main\n%rule text (\n```\n" });
  const elsewhere = directory({});
  process.chdir(elsewhere);
  for (const [root, bad] of [[included, "sub/g.md"], [pipeline, "p.md"]]) {
    const expected = slashed(path.join(root, bad));
    for (const given of [path.join(root, "p.md"), path.relative(elsewhere, path.join(root, "p.md"))]) {
      assert.throws(() => loadPipelineFile(given), (error) => {
        assert.ok(error instanceof GencmuError, String(error));
        assert.equal(error.where.document, expected, given);
        assert.ok(error.message.startsWith(`${expected}:`), error.message);
        return true;
      }, given);
    }
  }
});

for (const item of JSON.parse(fs.readFileSync(new URL("../../../tests/disk-names.json", import.meta.url), "utf8"))) {
  test(item.description, () => {
    const root = directory(item.files);
    process.chdir(root);
    try {
      assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind, "grammar");
        assert.deepEqual(error.where, {...item.error, document: slashed(path.join(root, item.error.document)), stage:"main"});
        return true;
      });
    } finally { process.chdir(home); }
  });
}

test("an unreadable document is a grammar error and a missing document stays missing", () => {
  for (const depth of [0, 1, 2]) {
    for (const exists of [false, true]) {
      const root = directory(depth > 0 ? {"p.md":'```jbogenbau\n%stage main\n%include "g.md"\n```\n'} : {});
      const file = path.join(root, ["p.md", "g.md", "h.md"][depth]);
      if (depth === 2) fs.writeFileSync(path.join(root, "g.md"), '```jbogenbau\n%include "h.md"\n```\n');
      if (exists) fs.mkdirSync(file);
      assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind, "grammar");
        assert.match(error.message, exists ? /the document could not be read:/ : /was not found/);
        assert.ok(error.message.includes(slashed(file)), error.message);
        assert.equal(error.toJSON().kind, "grammar");
        assert.equal(error.where.document, slashed(path.join(root, depth === 2 ? "g.md" : "p.md")));
        if (depth > 0) {
          assert.equal(error.where.line, depth === 2 ? 2 : 3);
          assert.equal(error.where.column, 1);
        }
        return true;
      });
    }
  }
});

test("grammar messages and JSON include the full known location once", () => {
  const root = directory({"p.md":'```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text other\n```\n'});
  assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
    assert.ok(error instanceof GencmuError);
    const prefix = `${slashed(path.join(root, "p.md"))}:4:1: `;
    assert.ok(error.message.startsWith(prefix), error.message);
    assert.equal(error.message.indexOf(prefix, prefix.length), -1);
    assert.equal(error.toJSON().message, error.message);
    return true;
  });
  const at = {document:"p.md", line:7, column:3};
  for (const message of ["bad grammar", "p.md: bad grammar", "p.md:7: bad grammar", "p.md:7:3: bad grammar"]) {
    const error = new GencmuError("grammar", message, at);
    assert.equal(error.message, "p.md:7:3: bad grammar");
    assert.equal(error.toJSON().message, error.message);
  }
});


test("a names path keeps parents above the source-map base", () => {
  const sources = {
    "dir/p.md": '```jbogenbau\n%names "../../extra.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹TEST PRIVATE SCALAR›"\n```\n',
    "../extra.txt": "unicode-names 15.1.0\nname E000 TEST PRIVATE SCALAR\n",
    "extra.txt": "unicode-names 15.1.0\nname E001 TEST PRIVATE SCALAR\n",
  };
  assert.equal(loadPipelineSources(sources, "dir/p.md").parse("\ue000").ok, true);
});


test("missing and unreadable bundled resources are grammar errors without CLI stacks", () => {
  const root = directory({"package.json":'{"type":"module"}'});
  fs.cpSync(new URL("../src", import.meta.url), path.join(root, "src"), {recursive:true});
  const cli = path.join(root, "cli.js");
  fs.copyFileSync(new URL("../cli.js", import.meta.url), cli);
  const node = pathToFileURL(path.join(root, "src/node.js")).href;
  const checkLibrary = method => {
    const code = `import assert from "node:assert/strict";
      const api = await import(${JSON.stringify(node)});
      assert.throws(() => api[${JSON.stringify(method)}](), error =>
        error instanceof api.GencmuError && error.kind === "grammar" && error.where.document === "grammars");`;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], {encoding:"utf8"});
    assert.equal(out.status, 0, out.stderr);
  };
  const checkCli = code => {
    const out = code === undefined
      ? spawnSync(process.execPath, [cli, "pipelines"], {encoding:"utf8"})
      : spawnSync(process.execPath, ["--input-type=module", "-e", code], {encoding:"utf8"});
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, /^gencmu: grammars/);
    assert.doesNotMatch(out.stderr, /\n\s+at /);
    assert.equal(out.stdout, "");
  };
  checkLibrary("bundledGrammarsDirectory");
  checkCli();
  fs.mkdirSync(path.join(root, "data/unicode"), {recursive:true});
  fs.writeFileSync(path.join(root, "data/unicode/unicode.txt"), "unicode 15.1.0\n");
  checkLibrary("bundledPipelines");
  checkCli();
  fs.writeFileSync(path.join(root, "grammars"), "a file cannot be scanned as a directory");
  checkLibrary("bundledPipelines");
  checkCli();
  fs.rmSync(path.join(root, "grammars"));
  fs.mkdirSync(path.join(root, "grammars/test/pipeline"), {recursive:true});
  fs.writeFileSync(path.join(root, "grammars/test/pipeline/pipeline.md"), "# A test pipeline\n");
  for (const method of ["statSync", "readFileSync"]) {
    const code = `import fs from "node:fs";
      const original = fs[${JSON.stringify(method)}];
      fs[${JSON.stringify(method)}] = (file, ...args) => {
        if (String(file).endsWith("pipeline.md")) throw Object.assign(new Error("permission denied"), {code:"EACCES"});
        return original.call(fs, file, ...args);
      };
      process.argv = [process.execPath, ${JSON.stringify(cli)}, "pipelines"];
      await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    checkCli(code);
  }
});


test("pipeline paths refuse lone surrogates", () => {
  const invalid = "invalid-\udcff.md";
  for (const load of [() => loadPipelineFile(invalid), () => loadPipelineSources({}, invalid)]) {
    assert.throws(load, error => error.kind === "usage" && /path is not valid UTF-8/.test(error.message));
  }
});
