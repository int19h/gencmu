import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { loadEngineCase, parseEngineCase, runEngineCase, checkEngineOutcome } from "./shared.js";
import { hooks, newWork } from "../src/testing.js";
import { audit, formatAudit } from "../src/diagnostics.js";

const directory = new URL("../../../tests/engine/", import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));

test("every shared family case agrees with the whole-observation deletion test", () => {
  let comparisons = 0;
  hooks.familyAlignment = (summary, direct) => {
    assert.equal(summary, direct);
    comparisons++;
  };
  try {
    for (const file of fs.readdirSync(directory).filter(name => name.startsWith("without-elision-except-"))) {
      const fixture = read(file);
      if (fixture.parses) {
        const {dialect} = loadEngineCase(fixture);
        for (const run of fixture.parses) checkEngineOutcome(run.expect, parseEngineCase(dialect, fixture, run), file);
      } else checkEngineOutcome(fixture.expect, runEngineCase(fixture), file);
    }
  } finally {
    hooks.familyAlignment = null;
  }
  assert.ok(comparisons >= 70);
});

test("family audits keep closure order, locations and note order", () => {
  const grammar = [
    "%rule text X %conditions $.without-elision-except(empty).matches(text), $.without-elision-except(fam).matches(text)",
    "%rule empty Z",
    "%rule fam (a | b)",
    "%rule a c",
    "%rule b d",
    "%rule c X [+T<¬T>]",
    "%rule d Z",
    "%rule outside X %conditions $.without-elision-except(fam).matches(c)",
  ].join("\n");
  const {dialect} = loadEngineCase({grammar});
  const families = audit(dialect)[0].families;
  assert.deepEqual(families[0], {
    family:"empty", calls:[{rule:"text", document:"case/main.md", line:3, column:1}],
    members:["empty"], permitted:[], notes:[{kind:"empty"}],
  });
  assert.deepEqual(families[1].members, ["fam", "a", "b", "c", "d"]);
  assert.deepEqual(families[1].calls, [
    {rule:"text", document:"case/main.md", line:3, column:1},
    {rule:"outside", document:"case/main.md", line:10, column:1},
  ]);
  const optional = {terminal:"T", owner:"c", document:"case/main.md", line:8, column:1};
  assert.deepEqual(families[1].permitted, [optional]);
  assert.deepEqual(families[1].notes, [
    {kind:"never-omitted", ...optional}, {kind:"inert-member", rule:"d"},
    {kind:"unnamed-member", rule:"a"}, {kind:"unnamed-member", rule:"b"},
    {kind:"unnamed-member", rule:"c"}, {kind:"unnamed-member", rule:"d"},
  ]);
  assert.match(formatAudit(audit(dialect)), /permits T of c at case\/main.md:8:1/);
});

test("choice edges read left to right and stop at optionals", () => {
  const grammar = "%rule text X %conditions $.without-elision-except(fam).matches(text)\n%rule fam z | (q | y) | [w]\n%rule z Z\n%rule q Q\n%rule y Y\n%rule w W";
  const {dialect} = loadEngineCase({grammar});
  assert.deepEqual(audit(dialect)[0].families[0].members, ["fam", "z", "q", "y"]);
});

const growth = JSON.parse(fs.readFileSync(new URL("../../../tests/without-elision-growth.json", import.meta.url), "utf8"));

function grown(fixture, entry, length) {
  const candidate = {...fixture};
  if (entry.depths) {
    const ranked = entry.case.includes("ranked-sibling");
    const lines = fixture.grammar.split("\n").filter(line => !/^%rule r[1-9][0-9]* /.test(line));
    candidate.grammar = lines.map(line => line.replace(/r(?:10|16)\b/g, `r${length}`)).join("\n")
      + Array.from({length}, (_, index) => `\n%rule r${index+1} r${index} r${index}${ranked ? " | [+V]" : ""}`).join("");
  } else if (fixture.tokens) {
    candidate.tokens = Array.from({length}, () => ({...fixture.tokens[0]})).concat(fixture.tokens.slice(4));
  } else candidate.input = "x" + "a".repeat(length);
  return candidate;
}

function measure(fixture, entry, length, budget) {
  const candidate = grown(fixture, entry, length);
  const {dialect, loadError} = loadEngineCase(candidate);
  assert.equal(loadError, undefined);
  const work = newWork(budget);
  const start = performance.now();
  hooks.work = work;
  try { checkEngineOutcome(candidate.expect, parseEngineCase(dialect, candidate), entry.case); }
  finally { hooks.work = null; }
  const {items, packedEdges, closeStates, closeSequences, summaryContexts, familySummaries, familySteps} = work;
  return {length, items, packedEdges, closeStates, closeSequences, summaryContexts, familySummaries, familySteps,
    ms:performance.now()-start, memory:process.resourceUsage().maxRSS};
}

for (const [name, entry] of Object.entries(growth).filter(([name]) => name.startsWith("family"))) {
  test(`close family growth: ${name}`, t => {
    const fixture = read(entry.case.slice(7)), twin = read(entry.strictCase.slice(7));
    const measurements = [];
    for (const length of entry.lengths ?? entry.depths) {
      const budget = {};
      if (entry.itemsPerUnit !== undefined) budget.items = entry.itemsPerUnit*length+entry.slack;
      if (entry.nodesPerDepth !== undefined) budget.closeSequences = budget.closeStates = entry.nodesPerDepth*(length+1)+entry.slack;
      if (entry.maxCloseNodes !== undefined) budget.closeSequences = entry.maxCloseNodes;
      if (entry.maxCloseStates !== undefined) budget.closeStates = entry.maxCloseStates;
      const strict = measure(twin, entry, length, budget);
      if (entry.strictBound) assert.ok(strict.closeStates <= entry.strictBound.closeStatesPerUnit*length+entry.strictBound.closeStatesSlack);
      if (entry.overStrict) {
        const over = entry.overStrict;
        budget.items = Math.min(budget.items ?? Infinity, strict.items*((over.itemsPercent ?? 0)+(over.itemsPercentPerUnit ?? 0)*length)/100+(over.itemsSlack ?? 0));
        budget.closeStates = Math.min(budget.closeStates ?? Infinity, strict.closeStates+(over.closeStatesPerUnit ?? 0)*length);
      }
      if (entry.equalsStrict || entry.atMostStrict) {
        budget.items = strict.items;
        budget.closeStates = strict.closeStates;
      }
      if (entry.summaries) budget.familySummaries = entry.summaries.perSquare*length**2+entry.summaries.slack;
      if (entry.steps) budget.familySteps = entry.steps.perCube*length**3+entry.steps.slack;
      const family = measure(fixture, entry, length, budget);
      if (entry.equalsStrict) {
        assert.equal(family.items, strict.items);
        assert.equal(family.closeStates, strict.closeStates);
      }
      measurements.push({strict, family});
    }
    t.diagnostic(JSON.stringify({name, measurements}));
  });
}
