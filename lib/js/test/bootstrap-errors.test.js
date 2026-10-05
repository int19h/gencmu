// Shared metadata for errors while constructing the notation bootstrap.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadDialectSources, loaderFromDirectory, GencmuError } from "../src/node.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../../tests/bootstrap-errors.json", import.meta.url), "utf8"));
const bundled = fs.readFileSync(new URL("../../../grammars/notation/bootstrap.json", import.meta.url), "utf8");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-bootstrap-cli-"));
fs.cpSync(new URL("../src", import.meta.url), path.join(directory, "src"), { recursive: true });
fs.copyFileSync(new URL("../cli.js", import.meta.url), path.join(directory, "cli.js"));
fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
fs.mkdirSync(path.join(directory, "grammars/notation"), { recursive: true });
fs.copyFileSync(new URL("../../../grammars/unicode.txt", import.meta.url), path.join(directory, "grammars/unicode.txt"));
fs.writeFileSync(path.join(directory, "p.md"), '```jbogenbau\n%stage main\n%include "g.md"\n```\n');
fs.writeFileSync(path.join(directory, "g.md"), "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n");
process.on("exit", () => fs.rmSync(directory, { recursive: true, force: true }));
for (const item of fixtures.cases) {
  test(item.description, () => {
    if (item.find) assert.ok(bundled.includes(item.find), item.description);
    const bootstrap = item.bootstrap ?? bundled.replace(item.find, item.replace);
    assert.throws(() => loadDialectSources({
      "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
      "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n",
      "notation/bootstrap.json": bootstrap,
    }, "p.md"), (error) => {
      assert.ok(error instanceof GencmuError, item.description);
      assert.equal(error.kind, fixtures.kind, error.message);
      assert.equal(error.where.document, fixtures.document, error.message);
      assert.ok(error.message.startsWith(`${fixtures.document}:`), error.message);
      if (item.context) assert.ok(error.message.includes(item.context), error.message);
      if (item.message) assert.ok(error.message.includes(item.message), error.message);
      for (const field of ["stage", "line", "column"]) {
        if (item[field] === null) assert.ok(!(field in error.where), `${field} must be absent: ${error.message}`);
        else assert.equal(error.where[field], item[field], error.message);
      }
      return true;
    });
    fs.writeFileSync(path.join(directory, "grammars/notation/bootstrap.json"), bootstrap);
    const cli = spawnSync(process.execPath, [path.join(directory, "cli.js"), "parse", "--pipeline", path.join(directory, "p.md"), "x"], { encoding: "utf8" });
    assert.equal(cli.status, 2, cli.stderr);
    assert.ok(cli.stderr.startsWith(`gencmu: ${fixtures.document}:`), cli.stderr);
    if (item.context) assert.ok(cli.stderr.includes(item.context), cli.stderr);
  });
}

for (const failure of ["missing", "directory", "invalid UTF-8"]) {
  test(`bootstrap file reading fails: ${failure}`, () => {
    const file = path.join(directory, "grammars/notation/bootstrap.json");
    fs.rmSync(file, { force: true, recursive: true });
    if (failure === "directory") fs.mkdirSync(file);
    if (failure === "invalid UTF-8") fs.writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => loaderFromDirectory(path.join(directory, "grammars")), (error) => {
      assert.ok(error instanceof GencmuError, String(error));
      assert.equal(error.where.document, fixtures.document);
      assert.ok(error.message.startsWith(`${fixtures.document}:`), error.message);
      return true;
    });
    const cli = spawnSync(process.execPath, [path.join(directory, "cli.js"), "parse", "--pipeline", path.join(directory, "p.md"), "x"], { encoding: "utf8" });
    assert.equal(cli.status, 2, cli.stderr);
    assert.ok(cli.stderr.startsWith(`gencmu: ${fixtures.document}:`), cli.stderr);
  });
}
