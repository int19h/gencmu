// What the shared corpus cannot test in the bundled grammars. Some helper
// rules are one: the rest of the grammar reads the same texts either way, so
// each check loads a bundled dialect with one more syntax document, whose
// `text` is the helper, and parses a text with it. Elided terminators are
// another, since the corpus's brackets hide them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, bundledGrammarsDirectory, loadDialect, toBrackets } from "../src/node.js";

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
    // The syntax stage is the pipeline's last, so an %include at the end of
    // the pipeline adds the helper to it.
    assert.match(text, /^%stage syntax$/m);
    return text + `\n\`\`\`jbogenbau\n%include "../${probe}"\n\`\`\`\n`;
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

// The corpus's brackets hide elided terminators, so these check the elided
// boi of the experimental grammar directly (syntax/experimental.md, "Free
// modifiers, vocatives and indicators").
test("an elided boi after a number or a lerfu string is a node of the tree", () => {
  const dialect = loadDialect("experimental");
  const shown = (text, options = {}) => {
    const result = dialect.parse(text, options);
    assert.ok(result.ok, text);
    return toBrackets(result, { showElided: true });
  };
  assert.match(shown("li pa"), /pa ⟨boi⟩/);
  assert.match(shown("by klama"), /by ⟨boi⟩/);
  assert.doesNotMatch(shown("li pa boi"), /⟨boi⟩/);
  // A resolved parse, so elision-only writes the terminators back.
  const resolved = dialect.parse("li pa sei broda se'u");
  assert.equal(resolved.stages[resolved.stages.length - 1].verdict, "resolved");
  assert.ok(dialect.parse("li pa sei broda se'u", { elisionOnly: true }).ok);
  assert.match(shown("li pa sei broda se'u", { elisionOnly: true }), /pa \(⟨boi⟩/);
});
