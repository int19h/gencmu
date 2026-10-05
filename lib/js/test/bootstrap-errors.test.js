// Shared metadata for errors while constructing the notation bootstrap.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialectSources, GencmuError } from "../src/node.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../../tests/bootstrap-errors.json", import.meta.url), "utf8"));
const bundled = fs.readFileSync(new URL("../../../grammars/notation/bootstrap.json", import.meta.url), "utf8");
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
      if (item.line !== undefined) {
        assert.equal(error.where.line, item.line, error.message);
        assert.equal(error.where.column, item.column, error.message);
      }
      return true;
    });
  });
}
