// Helper rules of the bundled grammars that no whole text can test, because
// the rest of the grammar reads the same texts either way. Each check loads a
// bundled dialect with one more syntax document, whose `text` is the helper,
// and parses a text with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, bundledGrammarsDirectory } from "../src/node.js";

// The dialect NAME, with its syntax stage read as the helper RULE.
function helperDialect(name, rule) {
  const pipeline = `dialects/${name}.md`;
  const probe = "syntax/helper-probe.md";
  const loader = new Loader((relative) => {
    if (relative === probe) return "```jbogenbau\n%redefine-rule text\n  " + rule + "\n```\n";
    const file = path.join(bundledGrammarsDirectory(), ...relative.split("/"));
    if (!fs.existsSync(file)) return undefined;
    const text = fs.readFileSync(file, "utf8");
    if (relative !== pipeline) return text;
    const syntax = /^.*<\?stage syntax\?>$/m.exec(text);
    assert.ok(syntax, `${pipeline} has a syntax stage`);
    return text + `\n- [The helper](../${probe}) <?grammar?>\n`;
  });
  return loader.dialect(pipeline);
}

function reads(dialect, text) {
  const result = dialect.parse(text);
  return result.ok;
}

test("camxes-exp's tag_bo_ke_bridi_tail takes free modifiers only after its optional cu", () => {
  const helper = helperDialect("experimental", "tag-bo-ke-bridi-tail");
  assert.equal(reads(helper, "pu ke sei brodi se'u cu brode"), false);
  assert.equal(reads(helper, "pu ke cu sei brodi se'u brode"), true);
  assert.equal(reads(helper, "pu ke sei brodi se'u brode"), true);
  assert.equal(reads(helper, "pu bo brode"), true);
});

test("camxes-exp's tag_bo_subsentence takes no free modifier before .i", () => {
  const helper = helperDialect("experimental", "tag-bo-subsentence");
  assert.equal(reads(helper, "pu bo sei brodi se'u .i"), false);
  assert.equal(reads(helper, "pu bo .i"), true);
});
