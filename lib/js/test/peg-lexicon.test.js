// The lexicon tool compares word classes without changing either input.
// Bootstrap mode prints a classifier, and unsupported inputs fail clearly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "peg-lexicon.js");
const document = (body) => `# A lexicon\n\nProse stays unchanged.\n\n\`\`\`jbogenbau\n${body}\n\`\`\`\n\n## Differences\n\nThe closing section stays too.\n`;

function fixture(pegText, lexiconText, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peg-lexicon-"));
  try {
    const peg = path.join(directory, "g.peg");
    const lexicon = path.join(directory, "lexicon.md");
    fs.writeFileSync(peg, pegText);
    fs.writeFileSync(lexicon, lexiconText);
    const invoke = (...args) => {
      const result = spawnSync(process.execPath, [tool, peg, ...args], { encoding: "utf8" });
      assert.equal(result.error, undefined);
      assert.equal(fs.readFileSync(peg, "utf8"), pegText);
      assert.equal(fs.readFileSync(lexicon, "utf8"), lexiconText);
      return result;
    };
    run(lexicon, invoke);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("comparison reports changed classes and words missing from either side", () => {
  fixture("KOhA <- &cmavo ( m i / d o / k o h a ) &post_word\n",
    document('%classifier lexicon\n  "mi" ∈ KOhA\n  "mi" ∈ UI\n  "do" ∈ PA\n  "old" ∈ OLD'),
    (lexicon, invoke) => {
      const result = invoke(lexicon);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, '"do": PEG KOhA; lexicon PA\n"ko\'a": PEG KOhA; lexicon none\n"mi": PEG KOhA; lexicon KOhA, UI\n"old": PEG none; lexicon OLD\n4 differences (PEG 3 words; lexicon 3 words)\n');
      assert.equal(invoke(lexicon).stdout, result.stdout);
    });
});

test("comparison uses resolved keys and membership removal without implication tags", () => {
  fixture("KOhA <- &cmavo ( m i ) &post_word\n",
    document('%const $WORD "mi"\n%classifier lexicon\n  "$(WORD)" ∈ KOhA\n  "mi" ∈ UI\n  "mi" ∉ UI\n  "gone" ∈ UI\n  "gone" ∉ UI\n%implies KOhA ⟹ Indicator'),
    (lexicon, invoke) => {
      const result = invoke(lexicon);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "0 differences (PEG 1 words; lexicon 1 words)\n");
    });
});

test("bootstrap prints a sorted classifier and retains Zantufa's mixed Y list", () => {
  fixture("Y <- &cmavo ( y+ / i e h o ) &post_word\nKOhA <- &cmavo (\n  m i / d o\n) &post_word\n",
    document('%classifier lexicon "old" ∈ OLD'),
    (_lexicon, invoke) => {
      const result = invoke("--print-classifier");
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, '```jbogenbau\n%classifier lexicon\n  "do" "mi" ∈ KOhA\n  "ie\'o" "y" ∈ Y\n```\n');
      assert.equal(invoke("--print-classifier").stdout, result.stdout);
    });
});

test("hesitation and constructed numeral or letter forms are not literal cmavo keys", () => {
  fixture("Y <- &cmavo ( y+ ) &post_word\nBY <- &cmavo ( ybu / b y ) &post_word\nPA <- &cmavo ( digit / p a ) &post_word\n",
    document('%classifier lexicon\n  "by" ∈ BY\n  "pa" ∈ PA'),
    (lexicon, invoke) => {
      assert.equal(invoke(lexicon).status, 0);
      const printed = invoke("--print-classifier");
      assert.equal(printed.status, 0);
      assert.equal(printed.stdout, '```jbogenbau\n%classifier lexicon\n  "by" ∈ BY\n  "pa" ∈ PA\n```\n');
    });
});

test("invalid inputs fail without modifying the lexicon", () => {
  fixture("PA <- &cmavo ( p a ) &post_word\n",
    document('%classifier lexicon\n  feature? "pa" ∈ PA'),
    (lexicon, invoke) => {
      const gated = invoke(lexicon);
      assert.equal(gated.status, 2);
      assert.match(gated.stderr, /without feature gates/);
      assert.equal(invoke(lexicon, "--add", "PA=ro'oi").status, 2);
      assert.equal(invoke().status, 2);
    });
  fixture("PA <- &cmavo ( unknown ) &post_word\n",
    document('%classifier lexicon "pa" ∈ PA'),
    (lexicon, invoke) => {
      const unsupported = invoke(lexicon);
      assert.equal(unsupported.status, 2);
      assert.match(unsupported.stderr, /unsupported word list in PA/);
    });
  fixture("PA <- &cmavo ( p a ) &post_word\nUI <- &cmavo unknown &post_word\n",
    document('%classifier lexicon "pa" ∈ PA'),
    (lexicon, invoke) => {
      const unsupported = invoke(lexicon);
      assert.equal(unsupported.status, 2);
      assert.match(unsupported.stderr, /unsupported cmavo list for UI/);
    });
  fixture("PA <- &cmavo ( p a ) &post_word\n", document('%classifier other "pa" ∈ PA'),
    (lexicon, invoke) => {
      assert.match(invoke(lexicon).stderr, /no classifier named lexicon/);
    });
});
