// tools/peg-lexicon.js keeps the prose of a lexicon document before its
// first jbogenbau block, which the Markdown parser finds, and writes the
// blocks after it from a PEG grammar's selma'o lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "peg-lexicon.js");

test("the prose stays, and the blocks come from the PEG", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peg-lexicon-"));
  const peg = path.join(directory, "g.peg");
  const lexicon = path.join(directory, "lexicon.md");
  fs.writeFileSync(peg, "KOhA <- &cmavo ( m i / d o / k o h a ) &post_word\nUI <- &cmavo ( u i ) &post_word\n");
  // A fence shown in a code span and one in a list item are not the first
  // top-level block.
  const prose = "# A lexicon\n\nProse with ```` ```jbogenbau ```` in it.\n\n- An item\n  ```jbogenbau\n  %rule x 'x'\n  ```\n";
  fs.writeFileSync(lexicon, `${prose}\n\`\`\`jbogenbau\n%classifier lexicon\n  "old" ∈ OLD\n\`\`\`\n`);
  execFileSync("node", [tool, peg, lexicon, "UI"], { stdio: "ignore" });
  assert.equal(fs.readFileSync(lexicon, "utf8"), `${prose}\n\`\`\`jbogenbau\n%classifier lexicon\n  "do" "ko'a" "mi" ∈ KOhA\n  "ui" ∈ UI\n\`\`\`\n\n\`\`\`jbogenbau\n%implies UI ⟹ ~indicator\n\`\`\`\n`);
});

test("hesitation alone has no Y entry, while Zantufa's mixed Y list stays", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peg-lexicon-"));
  try {
    const peg = path.join(directory, "g.peg");
    const lexicon = path.join(directory, "lexicon.md");
    fs.writeFileSync(peg, "UI <- &cmavo ( u i ) &post_word\nY <- &cmavo ( y+ ) &post_word\n");
    fs.writeFileSync(lexicon, "# A lexicon\n");
    execFileSync("node", [tool, peg, lexicon], { stdio: "ignore" });
    const generated = fs.readFileSync(lexicon, "utf8");
    assert.match(generated, /"ui" ∈ UI/);
    assert.match(generated, /%implies UI ⟹ ~indicator/);
    assert.doesNotMatch(generated, /∈ Y|∪ Y|"y"/);
    execFileSync("node", [tool, peg, lexicon, "UI,Y"], { stdio: "ignore" });
    assert.equal(fs.readFileSync(lexicon, "utf8"), generated);
    fs.writeFileSync(peg, "Y <- &cmavo ( y+ / i e h o ) &post_word\n");
    execFileSync("node", [tool, peg, lexicon, ""], { stdio: "ignore" });
    const zantufa = fs.readFileSync(lexicon, "utf8");
    assert.match(zantufa, /"ie'o" "y" ∈ Y/);
    assert.doesNotMatch(zantufa, /%implies/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
