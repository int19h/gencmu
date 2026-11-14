import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExampleContext,
  checkExampleFile,
  checkExampleEntries,
  exampleProblems,
} from "../../../tools/examples.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const context = createExampleContext(root);

const VALID_EXAMPLE = {
  id: "a-sentence",
  title: "A sentence",
  text: "mi klama le zarci",
  pipelines: ["lojban/cll"],
  expect: "accepted",
  gloss: "I go to the market.",
  hint: "The stages turn letters into words, then build the sentence.",
  open: {
    document: "grammars/lojban/cll/syntax.md",
    rule: "sentence",
  },
};

function checkBroken(entries, runExamples = false, family = "lojban", file = "grammars/lojban/examples.json") {
  return checkExampleEntries(file, family, entries, context, { runExamples }).problems;
}

test("bundled example files pass format checks", () => {
  const { problems } = exampleProblems(root, { context, runExamples: false });
  assert.deepEqual(problems, []);
});

test("check 1: rejects non-array file, non-object entry, and unknown fields anywhere", () => {
  const nonArray = checkExampleFile("grammars/lojban/examples.json", "lojban", "{}", context, { runExamples: false }).problems;
  assert.equal(nonArray.length, 1);
  assert.match(nonArray[0], /grammars\/lojban\/examples\.json \(file\): example file must be a JSON array/);

  const nonObject = checkBroken(["not-an-object"]);
  assert.equal(nonObject.length, 1);
  assert.match(nonObject[0], /grammars\/lojban\/examples\.json \(entry #1\): example entry must be an object/);

  const unknownTop = checkBroken([{ ...VALID_EXAMPLE, bogusTop: 1 }]);
  assert.equal(unknownTop.length, 1);
  assert.match(unknownTop[0], /grammars\/lojban\/examples\.json \(a-sentence\): unknown field "bogusTop"/);

  const unknownOpen = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/syntax.md", rule: "sentence", extra: true },
    },
  ]);
  assert.equal(unknownOpen.length, 1);
  assert.match(unknownOpen[0], /grammars\/lojban\/examples\.json \(a-sentence\): unknown field "extra" in open/);

  const unknownByPipeline = checkBroken([
    {
      ...VALID_EXAMPLE,
      byPipeline: { "lojban/cll": { unknownOverride: 1 } },
    },
  ]);
  assert.equal(unknownByPipeline.length, 1);
  assert.match(
    unknownByPipeline[0],
    /grammars\/lojban\/examples\.json \(a-sentence\): unknown field "unknownOverride" in byPipeline\["lojban\/cll"\]/
  );
});

test("check 2: rejects missing required field, empty text, empty pipelines, and period on title", () => {
  for (const field of ["id", "title", "text", "pipelines", "expect"]) {
    const copy = { ...VALID_EXAMPLE };
    delete copy[field];
    const problems = checkBroken([copy]);
    assert.ok(
      problems.some((m) => m.includes("grammars/lojban/examples.json") && m.includes(`missing required field "${field}"`)),
      `expected missing ${field} to fail, got ${JSON.stringify(problems)}`
    );
  }

  const emptyText = checkBroken([{ ...VALID_EXAMPLE, text: "" }]);
  assert.match(emptyText.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): text must not be empty/);

  const emptyPipelines = checkBroken([{ ...VALID_EXAMPLE, pipelines: [] }]);
  assert.match(emptyPipelines.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): pipelines must be a non-empty array/);

  const periodTitle = checkBroken([{ ...VALID_EXAMPLE, title: "A sentence." }]);
  assert.match(periodTitle.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): title must not end with a period/);
});

test("check 3: rejects repeated id or id of the wrong form", () => {
  const repeated = checkBroken([VALID_EXAMPLE, { ...VALID_EXAMPLE, title: "Another" }]);
  assert.match(repeated.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): repeated id "a-sentence"/);

  for (const badId of ["Upper-Case", "under_score", "-leading", "trailing-", "double--hyphen"]) {
    const problems = checkBroken([{ ...VALID_EXAMPLE, id: badId }]);
    assert.match(
      problems.join("\n"),
      new RegExp(`grammars/lojban/examples\\.json \\(${badId}\\): invalid id "${badId}"`)
    );
  }
});

test("check 4: rejects unknown pipeline, pipeline of another family, or repeated pipeline", () => {
  const unknownP = checkBroken([{ ...VALID_EXAMPLE, pipelines: ["lojban/nonexistent"] }]);
  assert.match(unknownP.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): unknown pipeline "lojban\/nonexistent"/);

  const wrongFamily = checkBroken([{ ...VALID_EXAMPLE, pipelines: ["eberban/refgram"] }]);
  assert.match(
    wrongFamily.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): pipeline "eberban\/refgram" belongs to another family/
  );

  const repeatedP = checkBroken([{ ...VALID_EXAMPLE, pipelines: ["lojban/cll", "lojban/cll"] }]);
  assert.match(
    repeatedP.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): repeated pipeline "lojban\/cll" in pipelines/
  );
});

test("check 5: rejects byPipeline key not in pipelines or field that cannot be overridden", () => {
  const unlistedKey = checkBroken([
    {
      ...VALID_EXAMPLE,
      byPipeline: { "lojban/experimental": { hint: "Other" } },
    },
  ]);
  assert.match(
    unlistedKey.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): byPipeline key "lojban\/experimental" is not in pipelines/
  );

  for (const forbidden of ["id", "title", "text", "pipelines", "expect", "stage", "gloss"]) {
    const problems = checkBroken([
      {
        ...VALID_EXAMPLE,
        byPipeline: { "lojban/cll": { [forbidden]: "x" } },
      },
    ]);
    assert.match(
      problems.join("\n"),
      new RegExp(`grammars/lojban/examples\\.json \\(a-sentence\\): byPipeline\\["lojban/cll"\\] cannot override "${forbidden}"`)
    );
  }
});

test("check 6: rejects invalid expect, stage with accepted, missing required stage, or unknown stage", () => {
  const badExpect = checkBroken([{ ...VALID_EXAMPLE, expect: "maybe" }]);
  assert.match(badExpect.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): unknown expect value "maybe"/);

  const stageWithAccepted = checkBroken([{ ...VALID_EXAMPLE, expect: "accepted", stage: "syntax" }]);
  assert.match(
    stageWithAccepted.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): stage is forbidden when expect is "accepted"/
  );

  const missingStage = checkBroken([{ ...VALID_EXAMPLE, expect: "rejected" }]);
  assert.match(
    missingStage.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): stage is required when expect is "rejected"/
  );

  const unknownStage = checkBroken([{ ...VALID_EXAMPLE, expect: "rejected", stage: "no-such-stage" }]);
  assert.match(
    unknownStage.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): unknown stage "no-such-stage" in pipeline "lojban\/cll"/
  );
});

test("check 7: rejects feature that a target pipeline does not declare", () => {
  const undeclaredTop = checkBroken([
    {
      ...VALID_EXAMPLE,
      features: { "cbm": true },
    },
  ]);
  assert.match(
    undeclaredTop.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): pipeline "lojban\/cll" does not declare feature "cbm"/
  );

  const undeclaredByPipeline = checkBroken([
    {
      ...VALID_EXAMPLE,
      byPipeline: {
        "lojban/cll": {
          features: { "no-such-feature": false },
        },
      },
    },
  ]);
  assert.match(
    undeclaredByPipeline.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): pipeline "lojban\/cll" does not declare feature "no-such-feature"/
  );
});

test("check 8: rejects open with no document or document outside target pipeline", () => {
  const noDoc = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { rule: "sentence" },
    },
  ]);
  assert.match(noDoc.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): open has no document/);

  const outsideDoc = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
    },
  ]);
  assert.match(
    outsideDoc.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): open document "grammars\/lojban\/experimental\/syntax\.md" is outside pipeline "lojban\/cll"/
  );
});

test("check 9: rejects open with both or neither of rule and anchor", () => {
  const neither = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/syntax.md" },
    },
  ]);
  assert.match(
    neither.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): open must have either rule or anchor, not both or neither/
  );

  const both = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: {
        document: "grammars/lojban/cll/syntax.md",
        rule: "sentence",
        anchor: "%rule sentence",
      },
    },
  ]);
  assert.match(
    both.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): open must have either rule or anchor, not both or neither/
  );
});

test("check 10: rejects rule not in document or anchor not occurring exactly once", () => {
  const missingRule = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/syntax.md", rule: "no-such-rule" },
    },
  ]);
  assert.match(
    missingRule.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): rule "no-such-rule" does not exist in "grammars\/lojban\/cll\/syntax\.md" for pipeline "lojban\/cll"/
  );

  const ruleInWrongDoc = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/pipeline.md", rule: "sentence" },
    },
  ]);
  assert.match(
    ruleInWrongDoc.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): rule "sentence" does not exist in "grammars\/lojban\/cll\/pipeline\.md" for pipeline "lojban\/cll"/
  );

  const missingAnchor = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/pipeline.md", anchor: "NO_SUCH_ANCHOR_STRING" },
    },
  ]);
  assert.match(
    missingAnchor.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): anchor "NO_SUCH_ANCHOR_STRING" occurs 0 times/
  );

  const repeatedAnchor = checkBroken([
    {
      ...VALID_EXAMPLE,
      open: { document: "grammars/lojban/cll/syntax.md", anchor: "%rule " },
    },
  ]);
  assert.match(
    repeatedAnchor.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): anchor "%rule " occurs \d+ times in "grammars\/lojban\/cll\/syntax\.md" \(expected 1\)/
  );
});

test("check 11: rejects view value not in the allowed list", () => {
  const badView = checkBroken([{ ...VALID_EXAMPLE, view: "canonical" }]);
  assert.match(badView.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): unknown view "canonical"/);

  const badOverrideView = checkBroken([
    {
      ...VALID_EXAMPLE,
      byPipeline: { "lojban/cll": { view: "table" } },
    },
  ]);
  assert.match(
    badOverrideView.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): unknown view "table" in byPipeline\["lojban\/cll"\]/
  );
});

test("check 12: rejects warnings with expect other than accepted", () => {
  const topWarnOnReject = checkBroken([
    {
      ...VALID_EXAMPLE,
      pipelines: ["lojban/experimental"],
      expect: "rejected",
      stage: "syntax",
      warnings: ["experimental-cgv"],
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
    },
  ]);
  assert.match(
    topWarnOnReject.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): warnings is only allowed when expect is "accepted"/
  );

  const overrideWarnOnReject = checkBroken([
    {
      ...VALID_EXAMPLE,
      pipelines: ["lojban/experimental"],
      expect: "rejected",
      stage: "syntax",
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
      byPipeline: {
        "lojban/experimental": { warnings: ["experimental-cgv"] },
      },
    },
  ]);
  assert.match(
    overrideWarnOnReject.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): byPipeline\["lojban\/experimental"\]\.warnings is only allowed when expect is "accepted"/
  );
});

test("check 13: rejects empty warnings list or repeated code in warnings", () => {
  const emptyWarn = checkBroken([
    {
      ...VALID_EXAMPLE,
      pipelines: ["lojban/experimental"],
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
      warnings: [],
    },
  ]);
  assert.match(emptyWarn.join("\n"), /grammars\/lojban\/examples\.json \(a-sentence\): warnings must be a non-empty array/);

  const dupWarn = checkBroken([
    {
      ...VALID_EXAMPLE,
      pipelines: ["lojban/experimental"],
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
      warnings: ["experimental-cgv", "experimental-cgv"],
    },
  ]);
  assert.match(
    dupWarn.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): repeated warning code "experimental-cgv" in warnings/
  );
});

test("check 14: rejects warning code not declared as a warning feature by target pipeline", () => {
  const gateAsWarning = checkBroken([
    {
      ...VALID_EXAMPLE,
      warnings: ["sa-su"],
    },
  ]);
  assert.match(
    gateAsWarning.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): pipeline "lojban\/cll" does not declare "sa-su" as a warning feature/
  );
});

test("check 15: rejects warning code that merged features turn off", () => {
  const turnedOff = checkBroken([
    {
      ...VALID_EXAMPLE,
      pipelines: ["lojban/experimental"],
      open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
      features: { "experimental-cgv": false },
      warnings: ["experimental-cgv"],
    },
  ]);
  assert.match(
    turnedOff.join("\n"),
    /grammars\/lojban\/examples\.json \(a-sentence\): warning "experimental-cgv" is turned off by the merged features for pipeline "lojban\/experimental"/
  );
});

test("run check: fails when outcome, stage, or warnings do not match", () => {
  const wrongOutcome = checkBroken(
    [
      {
        ...VALID_EXAMPLE,
        expect: "rejected",
        stage: "syntax",
      },
    ],
    true
  );
  assert.equal(wrongOutcome.length, 1);
  assert.match(
    wrongOutcome[0],
    /grammars\/lojban\/examples\.json \(a-sentence, lojban\/cll\): expected rejected stage=syntax, got accepted/
  );

  const wrongStage = checkBroken(
    [
      {
        ...VALID_EXAMPLE,
        text: "mi klama le le",
        expect: "rejected",
        stage: "words",
      },
    ],
    true
  );
  assert.equal(wrongStage.length, 1);
  assert.match(
    wrongStage[0],
    /grammars\/lojban\/examples\.json \(a-sentence, lojban\/cll\): expected rejected stage=words, got rejected stage=syntax/
  );

  const wrongWarnings = checkBroken(
    [
      {
        ...VALID_EXAMPLE,
        pipelines: ["lojban/experimental"],
        open: { document: "grammars/lojban/experimental/syntax.md", rule: "sentence" },
        warnings: ["experimental-cgv"],
      },
    ],
    true
  );
  assert.equal(wrongWarnings.length, 1);
  assert.match(
    wrongWarnings[0],
    /grammars\/lojban\/examples\.json \(a-sentence, lojban\/experimental\): expected accepted warnings=\[experimental-cgv\], got accepted/
  );
});

test("run check: distinguishes tie and elision-only ambiguous outcomes by error.reason", () => {
  const customDocs = new Map([
    [
      "grammars/test/tie/pipeline.md",
      "```jbogenbau\n%stage syntax\n%ambiguity-resolution greedy\n%rule text a | b\n%rule a \"a\"\n%rule b \"a\"\n```\n",
    ],
    [
      "grammars/test/elision/pipeline.md",
      "```jbogenbau\n%stage chars\n%ambiguity-resolution greedy\n%rule text \"a\" :: A %emits $\n%stage syntax\n%ambiguity-resolution late #·_<_Elided>\n%elision-only\n%rule text a | b | c\n%rule a (A [+T])\n%rule b (A [+T] [+T])\n%rule c (A T)\n```\n",
    ],
  ]);
  const customCtx = createExampleContext(root, {
    readSource: (rel) => (customDocs.has(rel) ? customDocs.get(rel) : context.readSource(rel)),
    knownPipelines: new Set(["test/tie", "test/elision"]),
  });

  const tiePass = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "tie-case",
        title: "A tie",
        text: "a",
        pipelines: ["test/tie"],
        expect: "tie",
        stage: "syntax",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.deepEqual(tiePass.problems, []);

  const tieMismatch = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "tie-case",
        title: "A tie",
        text: "a",
        pipelines: ["test/tie"],
        expect: "elision-only",
        stage: "syntax",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.equal(tieMismatch.problems.length, 1);
  assert.match(
    tieMismatch.problems[0],
    /grammars\/test\/examples\.json \(tie-case, test\/tie\): expected elision-only stage=syntax, got tie stage=syntax/
  );

  const elisionPass = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "elision-case",
        title: "An elision-only failure",
        text: "a",
        pipelines: ["test/elision"],
        expect: "elision-only",
        stage: "syntax",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.deepEqual(elisionPass.problems, []);

  const elisionMismatch = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "elision-case",
        title: "An elision-only failure",
        text: "a",
        pipelines: ["test/elision"],
        expect: "tie",
        stage: "syntax",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.equal(elisionMismatch.problems.length, 1);
  assert.match(
    elisionMismatch.problems[0],
    /grammars\/test\/examples\.json \(elision-case, test\/elision\): expected tie stage=syntax, got elision-only stage=syntax/
  );
});

test("run check: treats a pipeline load error as outcome grammar", () => {
  const customDocs = new Map([
    [
      "grammars/test/broken/pipeline.md",
      "```jbogenbau\n%stage syntax\n%ambiguity-resolution greedy\n%rule text undefined-rule\n```\n",
    ],
  ]);
  const customCtx = createExampleContext(root, {
    readSource: (rel) => (customDocs.has(rel) ? customDocs.get(rel) : context.readSource(rel)),
    knownPipelines: new Set(["test/broken"]),
  });

  const grammarPass = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "broken-pipeline",
        title: "A pipeline that fails to load",
        text: "a",
        pipelines: ["test/broken"],
        expect: "grammar",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.deepEqual(grammarPass.problems, []);

  const grammarMismatch = checkExampleEntries(
    "grammars/test/examples.json",
    "test",
    [
      {
        id: "broken-pipeline",
        title: "A pipeline that fails to load",
        text: "a",
        pipelines: ["test/broken"],
        expect: "accepted",
      },
    ],
    customCtx,
    { runExamples: true }
  );
  assert.equal(grammarMismatch.problems.length, 1);
  assert.match(
    grammarMismatch.problems[0],
    /grammars\/test\/examples\.json \(broken-pipeline, test\/broken\): expected accepted, got grammar/
  );
});
