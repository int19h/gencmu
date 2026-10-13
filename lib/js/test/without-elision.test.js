import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Token } from "../src/tokens.js";
import { loadEngineCase, parseEngineCase, runEngineCase, checkEngineOutcome } from "./shared.js";
import { countedWork } from "./linear.js";
import { CloseObservations } from "../src/close-observations.js";

function single(grammar) {
  const loaded = loadEngineCase({ grammar });
  if (loaded.loadError) throw loaded.loadError;
  return loaded.dialect;
}

function supplied(tag, span, source, text = "x", sound = "x") {
  return new Token(new Set([tag]), span, source, text, sound, undefined);
}

test("aligned query keys retain original source observations", () => {
  const dialect = single([
    "%rule text $a:candidate $b:candidate",
    "%conditions $a.without-elision.tags(probe) = P, $b.without-elision.tags(probe) = Q",
    "%rule candidate X [+T]",
    "%rule probe X [+T] ::($.source-text = \"p\" ⟹ P) ∪ ($.source-text = \"q\" ⟹ Q)",
  ].join("\n"));
  for (const source of [[0, 1, 2, 3], [2, 3, 0, 1]]) {
    const text = source[0] === 0 ? "p q" : "q p";
    const tokens = [
      supplied("X", [0, 1], source.slice(0, 2)),
      supplied("X", [1, 2], source.slice(2)),
    ];
    const result = dialect.parse(text, { tokens, autoFeatures: false });
    assert.equal(result.ok, true, result.error?.message);
  }
});

test("original tokens with empty sources retain their written terminal status", () => {
  const dialect = single([
    "%rule text $x:candidate",
    "%conditions $x.without-elision.matches(rival), $x.without-elision.source-text = \"\"",
    "%rule candidate X T [+U]",
    "%rule rival X T [+U]",
  ].join("\n"));
  const result = dialect.parse("", {
    tokens: [supplied("X", [0, 0], [0, 0], "", ""), supplied("T", [0, 0], [0, 0], "", "")],
    autoFeatures: false,
  });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.tree.children[0].children[1].kind, "token");
  assert.equal(result.tree.children[0].children[1].terminal, "T");
});

test("restored queries preserve original token attachments", () => {
  const testCase = {
    documents: {
      "p.md": [
        "```jbogenbau",
        "%stage first",
        "%ambiguity-resolution greedy",
        "%rule text $b:before $x:word $a:after",
        "%emits ($b) $x ($a)",
        "%rule before \"b\" ::B",
        "%emits $",
        "%rule word \"x\" ::X",
        "%rule after \"a\" ::A",
        "%emits $",
        "%stage main",
        "%ambiguity-resolution greedy",
        "%rule text $x:candidate",
        "%conditions $x.without-elision.matches(rival), $x.without-elision.source-text = \"x\"",
        "%emits $x",
        "%rule candidate X [+T]",
        "%rule rival X [+T]",
        "```",
      ].join("\n"),
    },
    pipeline: "p.md",
    input: "bxa",
    expect: { result: { ok: true } },
  };
  const outcome = runEngineCase(testCase);
  checkEngineOutcome(testCase.expect, outcome, "attachments");
  const output = outcome.json.stages[1].output[0];
  assert.deepEqual(output.before.map(token => token.text), ["b"]);
  assert.deepEqual(output.after.map(token => token.text), ["a"]);
  assert.equal(output.text, "x");
  assert.deepEqual(output.source, [1, 2]);
});

test("aligned emission queries use their captured closes", () => {
  const dialect = single([
    "%rule text $x:candidate",
    "%emits $x ::$x.without-elision.tags(rival)",
    "%rule candidate X [+T]",
    "%rule rival X [+T] ::Aligned | X [+U] ::Wrong",
  ].join("\n"));
  const result = dialect.parse("x", { tokens: [supplied("X", [0, 1], [0, 1])], autoFeatures: false });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual([...result.stages[0].output[0].tags], ["Aligned"]);
});

function measured(t, name, grammar, input, sizes) {
  const dialect = single(grammar);
  const measurements = [];
  for (const size of sizes) {
    const text = input(size);
    let result;
    const before = performance.now();
    const work = countedWork(() => {
      result = dialect.parse(text, { autoFeatures: false });
    }, { items: 1_000_000, closeStates: 1_000_000, closeSequences: 1_000_000 });
    assert.equal(result.ok, true, `${name} at ${size}: ${result.error?.message}`);
    assert.ok(work.closeStates > 0, `${name}: no close states counted`);
    measurements.push({
      size,
      items: work.items,
      packedEdges: work.packedEdges,
      closeStates: work.closeStates,
      closeSequences: work.closeSequences,
      structuralStates: work.structuralStates,
      summaryContexts: work.summaryContexts,
      elapsedMs: Math.round((performance.now() - before) * 1000) / 1000,
      heapUsed: process.memoryUsage().heapUsed,
      peakRss: process.resourceUsage().maxRSS * 1024,
    });
  }
  t.diagnostic(`${name}: ${JSON.stringify(measurements)}`);
  return measurements;
}

test("nested omissions retain sharing beyond sixty restored closes", t => {
  const grammar = [
    "%rule text $x:wrapper",
    "%conditions $x.without-elision.matches(wrapper)",
    "%rule wrapper \"a\" wrapper [+T] | \"x\"",
  ].join("\n");
  const measurements = measured(t, "nested omissions", grammar, n => "a".repeat(n) + "x", [16, 64, 128]);
  assert.ok(measurements[2].closeSequences >= 128);
  assert.ok(measurements[2].items < 12 * measurements[0].items);
});

test("repeated ambiguous ranked groups share their outside close observations", t => {
  const grammar = [
    "%rule text $x:body",
    "%conditions $x.without-elision.matches(body)",
    "%rule body {unit}",
    "%rule unit a ≻ b",
    "%rule a \"x\" [+T]",
    "%rule b \"x\" [+U]",
  ].join("\n");
  const measurements = measured(t, "ranked blocks", grammar, n => "x".repeat(n), [8, 32, 64]);
  assert.ok(measurements[2].closeStates < 12 * measurements[0].closeStates);
});

test("nested raw and explicit queries retain bounded proof growth", t => {
  const grammar = [
    "%rule text {unit}",
    "%rule unit $x:body",
    "%conditions $x.without-elision.matches(witness)",
    "%rule body \"x\" [+T]",
    "%rule witness $y:body",
    "%conditions $y.matches(raw), $y.without-elision.matches(aligned)",
    "%rule raw \"x\" [+U]",
    "%rule aligned \"x\" [+T]",
  ].join("\n");
  const measurements = measured(t, "nested queries", grammar, n => "x".repeat(n), [8, 32, 64]);
  assert.ok(measurements[2].closeStates < 12 * measurements[0].closeStates);
});

test("recursive query chains keep their projected original contexts", t => {
  const grammar = [
    "%rule text {\"a\"}",
    "%conditions $.onward.begins(q)",
    "%rule q $x:body",
    "%conditions $x.without-elision.matches(aligned), ¬$x.following-tokens.matches(q)",
    "%rule body \"a\" [+T]",
    "%rule aligned \"a\" [+T]",
  ].join("\n");
  const measurements = measured(t, "recursive query chains", grammar, n => "a".repeat(n), [16, 64, 128]);
  assert.ok(measurements[2].closeStates < 12 * measurements[0].closeStates);
});


test("close prefixes retain shared links and bounded alignment keys", t => {
  const measurements = [];
  for (const size of [128, 256, 512]) {
    const machine = new CloseObservations();
    let state = machine.empty;
    for (let index = 0; index < size; index++) {
      const previous = state;
      const event = machine.event({ kind: "close", terminal: "T", at: index, source: [index, index] });
      state = machine.concat(state, event);
      machine.identity(state);
      assert.equal(machine.aligned(state, state, index), true);
      assert.equal(machine.aligned(state, previous, index), false);
      assert.equal(machine.aligned(state, previous, index - 1), true);
    }
    let flattenedEventReferences = 0;
    for (const field of Object.values(machine)) {
      if (!(field instanceof Map)) continue;
      for (const value of field.values()) {
        if (Array.isArray(value) && value.some(event => event?.kind === "close" || event?.kind === "block")) {
          flattenedEventReferences += value.length;
        }
      }
    }
    const rawLinks = machine.sequences.length - 1;
    const alignmentStates = machine.alignmentIds.size;
    const retainedSequenceReferences = machine.events.length + 2 * rawLinks + 2 * alignmentStates + machine.sequenceAlignmentIds.size + flattenedEventReferences;
    const alignmentKeyCharacters = [...machine.alignmentIds.keys()].reduce((sum, key) => sum + key.length, 0);
    measurements.push({ size, rawLinks, alignmentStates, retainedSequenceReferences, flattenedEventReferences, alignmentKeyCharacters });
    assert.ok(rawLinks <= 2 * size);
    assert.ok(alignmentStates <= 2 * size);
    assert.equal(flattenedEventReferences, 0);
  }
  assert.ok(measurements[2].retainedSequenceReferences < 5 * measurements[0].retainedSequenceReferences);
  assert.ok(measurements[2].alignmentKeyCharacters < 6 * measurements[0].alignmentKeyCharacters);
  t.diagnostic(`close prefix storage: ${JSON.stringify(measurements)}`);
});


const growth = JSON.parse(fs.readFileSync(new URL("../../../tests/without-elision-growth.json", import.meta.url)));
const growthCase = JSON.parse(fs.readFileSync(new URL("../../../tests/" + growth.case, import.meta.url)));

function doublingGrammar(depth) {
  return growthCase.grammar.split("\n").slice(0, 5).map(line =>
    line.replace("r16", `r${depth}`)
  ).concat(Array.from({length:depth}, (_, i) => `%rule r${i+1} r${i} r${i}`)).join("\n");
}

test("shared nullable derivations obey the shared storage bound", t => {
  const measurements = [];
  for (const depth of growth.depths) {
    const budget = growth.nodesPerDepth * (depth + 1) + growth.slack;
    for (const witness of [false, true]) {
      const grammar = doublingGrammar(depth).replace(
        "$x.without-elision.matches(empty)",
        !witness ? "$x.without-elision.matches(empty)" : `¬$x.without-elision.matches(r${depth})`);
      let result;
      const counts = countedWork(() => { result = single(grammar).parse("", {autoFeatures:false}); },
        {closeSequences:budget,closeStates:budget});
      assert.equal(result.ok, true, result.error?.message);
      measurements.push({depth,witness,sequences:counts.closeSequences,states:counts.closeStates});
    }
  }
  t.diagnostic(JSON.stringify(measurements));
});

test("an unrelated ranked sibling keeps the ordinary chart and creates no closes", t => {
  const shared = growth.rankedSibling;
  const fixture = JSON.parse(fs.readFileSync(new URL("../../../tests/" + shared.case, import.meta.url)));
  const measurements = [];
  for (const depth of shared.depths) {
    const grammar = fixture.grammar.split("\n").slice(0, 7).join("\n").replace("r10", `r${depth}`)
      + Array.from({length:depth}, (_, i) => `
%rule r${i+1} r${i} r${i} | [+V]`).join("");
    const outputs = [], counts = [];
    for (const aligned of [false, true]) {
      const candidate = {...fixture, grammar: aligned ? grammar : grammar.replace("$x.without-elision", "$x")};
      const loaded = loadEngineCase(candidate);
      assert.equal(loaded.loadError, undefined);
      counts.push(countedWork(() => {
        const outcome = parseEngineCase(loaded.dialect, candidate);
        checkEngineOutcome(candidate.expect, outcome, `ranked sibling depth ${depth}`);
        outputs.push(outcome.json);
      }, {closeSequences:shared.maxCloseNodes}));
    }
    assert.deepEqual(outputs[1], outputs[0]);
    assert.equal(counts[1].items, counts[0].items);
    for (const count of counts) assert.equal(count.closeSequences, shared.maxCloseNodes);
    measurements.push({depth,items:counts[1].items,sequences:counts[1].closeSequences});
  }
  t.diagnostic(JSON.stringify(measurements));
});

test("unused aligned queries leave ordinary grammars without observations", () => {
  for (const file of growth.unusedCases) {
    const c = JSON.parse(fs.readFileSync(new URL("../../../tests/engine/" + file, import.meta.url)));
    c.grammar += "\n%rule unused $x:empty\n%conditions $x.without-elision.matches(empty)\n%rule empty ε";
    const counts = countedWork(() => checkEngineOutcome(c.expect,runEngineCase(c),file),
      {closeSequences:0,closeStates:0});
    assert.equal(counts.closeSequences,0);
    assert.equal(counts.closeStates,0);
  }
});

test("rope identities compare groupings exactly despite fingerprint collisions", () => {
  const m = new CloseObservations(0n);
  const a = m.event({kind:"close",terminal:"T",at:0,source:[0,0]});
  const b = m.event({kind:"close",terminal:"U",at:0,source:[0,0]});
  const left = m.concat(m.concat(a,b),a), right = m.concat(a,m.concat(b,a));
  assert.equal(m.identity(left),m.identity(right));
  assert.notEqual(m.identity(left),m.identity(m.concat(m.concat(a,a),b)));
  let large = a;
  for (let i=0;i<100;i++) large=m.concat(large,large);
  assert.equal(m.aligned(large,large,0),true);
  assert.equal(m.aligned(large,m.concat(large,large),0),false);
  assert.ok(m.sequences.length < 120);
});

test("a caller's close demand leaves other uses of its text rule shared", t => {
  for (const shared of [growth.callerScope,growth.impossiblePrefix]) {
    const fixture = JSON.parse(fs.readFileSync(new URL("../../../tests/" + shared.case, import.meta.url)));
    const dialect = single(fixture.grammar);
    const measurements = [];
    for (const length of shared.lengths) {
      let result;
      const counts = countedWork(() => {
        result = dialect.parse("x" + "a".repeat(length), {autoFeatures:false});
      }, {closeSequences:shared.maxCloseNodes, closeStates:shared.maxCloseStates,
        items:shared.itemsPerUnit * length + shared.slack});
      assert.equal(result.ok, false);
      assert.equal(result.error.reason, "tie");
      if (shared.maxCloseNodes) assert.ok(counts.closeStates > 0);
      assert.ok(counts.items > 0);
      measurements.push({length, items:counts.items, states:counts.closeStates, sequences:counts.closeSequences});
    }
    t.diagnostic(JSON.stringify({case:shared.case,measurements}));
  }
});
