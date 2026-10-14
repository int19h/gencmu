// tools/peg-lexicon.js replaces its classifier and indicator blocks from
// the PEG and declared additions, keeping the document's other content.
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
  const prose = "# A lexicon\n\nProse with ```` ```jbogenbau ```` in it.\n\n- An item\n  ```jbogenbau\n  %rule x \"x\"\n  ```\n";
  fs.writeFileSync(lexicon, `${prose}
\`\`\`jbogenbau
%classifier lexicon
  "old" ∈ OLD
\`\`\`
`);
  execFileSync("node", [tool, peg, lexicon, "UI"], { stdio: "ignore" });
  assert.equal(fs.readFileSync(lexicon, "utf8"), `${prose}
\`\`\`jbogenbau
%classifier lexicon
  "do" "ko'a" "mi" ∈ KOhA
  "ui" ∈ UI
\`\`\`

\`\`\`jbogenbau
%implies UI ⟹ Indicator
\`\`\`
`);
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
    assert.match(generated, /%implies UI ⟹ Indicator/);
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

test("declared additions survive regeneration with the closing section and other blocks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peg-lexicon-"));
  try {
    const peg = path.join(directory, "g.peg");
    const lexicon = path.join(directory, "lexicon.md");
    fs.writeFileSync(peg, "PA <- &cmavo ( p a ) &post_word\nUI <- &cmavo ( u i ) &post_word\n");
    const closing = "\n\n## Differences\n\nThe extra PA key stays.\n\n```jbogenbau\n%const $EXAMPLE \"example\"\n```\n";
    fs.writeFileSync(lexicon, "# A lexicon\n\n```jbogenbau\n%classifier lexicon\n  \"old\" ∈ OLD\n```\n\n```jbogenbau\n%implies OLD ⟹ Indicator\n```" + closing);
    const args = [tool, peg, lexicon, "UI", "--add", "PA=ro'oi", "--add", "PA=ro'oi"];
    execFileSync("node", args, { stdio: "ignore" });
    const generated = fs.readFileSync(lexicon, "utf8");
    assert.match(generated, /"pa" "ro'oi" ∈ PA/);
    assert.match(generated, /%implies UI ⟹ Indicator/);
    assert.doesNotMatch(generated, /OLD/);
    assert.ok(generated.endsWith(closing));
    execFileSync("node", args, { stdio: "ignore" });
    assert.equal(fs.readFileSync(lexicon, "utf8"), generated);
    execFileSync("node", [tool, peg, lexicon, "", "--add", "PA=ro'oi"], { stdio: "ignore" });
    assert.ok(fs.readFileSync(lexicon, "utf8").endsWith(closing));
    assert.doesNotMatch(fs.readFileSync(lexicon, "utf8"), /%implies/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an invalid or conflicting addition leaves the document unchanged", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peg-lexicon-"));
  try {
    const peg = path.join(directory, "g.peg");
    const lexicon = path.join(directory, "lexicon.md");
    fs.writeFileSync(peg, "PA <- &cmavo ( p a ) &post_word\n");
    const original = "# A lexicon\n";
    fs.writeFileSync(lexicon, original);
    for (const value of ["pa=ro'oi", "PA=", "UI=pa"]) {
      assert.throws(() => execFileSync("node", [tool, peg, lexicon, "--add", value], { stdio: "pipe" }));
      assert.equal(fs.readFileSync(lexicon, "utf8"), original);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
