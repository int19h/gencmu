import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suites = {
  engine: { file: "test/transition-differential.test.js", size: 30, limit: 120 },
  notation: { file: "test/transition-differential.test.js", size: 30, limit: 120 },
  matrix: { file: "test/transition-context-matrix.test.js", size: 120, limit: 300 },
  catalog: { file: "test/transition-translator.test.js", size: 50, limit: 75,
    pattern: "^(?:§9\\.3 order )?(?:engine|notation)/.*\\.json$" },
  written: { file: "test/transition-translator.test.js", size: 5, limit: 10,
    pattern: "^each written migration has format 50 source or an expected source error$" },
};
const packageDirectory = fileURLToPath(new URL("../../lib/js/", import.meta.url));

function checkBatch(suite, start, count) {
  assert.ok(Object.hasOwn(suites, suite), "use engine, notation, matrix, catalog or written");
  assert.ok(Number.isSafeInteger(start) && start >= 0, "use a nonnegative case index");
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= suites[suite].limit,
    `use a batch size from 1 through ${suites[suite].limit}`);
}

export function transitionBatch() {
  const request = process.env.GENCMU_TRANSITION_BATCH;
  if (request === undefined) return;
  const [suite, start, count] = JSON.parse(request);
  checkBatch(suite, start, count);
  return { suite, start, count };
}

function runBatch(suite, start, count) {
  const options = suites[suite];
  const selection = options.pattern ? [`--test-name-pattern=${options.pattern}`] : [];
  const result = spawnSync(process.execPath, ["--max-old-space-size=2048", "--test", "--test-isolation=none",
    "--test-reporter=spec", ...selection, options.file], {
    cwd: packageDirectory,
    env: { ...process.env, GENCMU_TRANSITION_BATCH: JSON.stringify([suite, start, count]) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    killSignal: "SIGKILL",
  });
  process.stdout.write(result.stdout ?? "");
  if (result.error?.code === "ETIMEDOUT" && count > 1) {
    const left = Math.floor(count / 2);
    console.log(`Split timed-out ${suite} batch ${start} ${count}`);
    const total = runBatch(suite, start, left);
    const right = Math.min(count - left, total - start - left);
    if (right > 0) runBatch(suite, start + left, right);
    return total;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${suite} batch ${start} ${count} failed (${result.signal ?? result.status})`);
  const line = result.stdout.split("\n").find(line => line.startsWith('{"differential":'));
  assert.ok(line, "the batch did not report its coverage");
  const { total, cases } = JSON.parse(line);
  assert.ok(Number.isSafeInteger(total) && cases === Math.min(count, total - start) && cases > 0,
    `incomplete coverage for ${suite} batch ${start} ${count}`);
  const passed = /^ℹ pass (\d+)$/m.exec(result.stdout);
  const expectedTests = suite === "matrix" ? cases + 1 : suite === "catalog" ? cases : 1;
  assert.equal(Number(passed?.[1]), expectedTests, "the batch did not run every selected test");
  return total;
}

function main(args) {
  const [suite, first, size, ...rest] = args;
  assert.ok(!rest.length, "usage: sweep.js [SUITE [START [COUNT]]]");
  for (const name of suite ? [suite] : Object.keys(suites)) {
    const count = size === undefined ? suites[name]?.size : Number(size);
    const start = first === undefined ? 0 : Number(first);
    checkBatch(name, start, count);
    if (process.env.GENCMU_DIFFERENTIAL_MUTATION_COUNT !== undefined) {
      assert.ok((name === "engine" || name === "notation") && first !== undefined && count === 1,
        "select one shared fixture for a mutation window");
    }
    const total = runBatch(name, start, count);
    if (first === undefined) {
      for (let next = count; next < total; next += count) runBatch(name, next, Math.min(count, total - next));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
