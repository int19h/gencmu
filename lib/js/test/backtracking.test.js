// Scans that once used a regex which backtracks over a long run of one
// kind of character. A count of work cannot see a regex engine's steps, so
// each test gives a scan a run of 200,000 such characters in a worker, under
// a hang guard that ends the worker. A quadratic scan of the run takes
// about 10^10 steps and never finishes in time, while a linear one takes
// milliseconds. The guard is a worker because a timeout of node:test cannot
// stop code that never yields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const RUN = 200000;
const GUARD_MS = 60000;

/**
 * Runs `body`, the text of an async function of `RUN`, in a worker, and
 * gives its result, or fails once the guard runs out.
 * @param {string} body
 * @returns {Promise<unknown>}
 */
function guarded(body) {
  const source = `const { parentPort } = require("node:worker_threads");
    (async (RUN) => { ${body} })(${RUN}).then((value) => parentPort.postMessage({ value }), (error) => parentPort.postMessage({ error: String(error && error.stack || error) }));`;
  const worker = new Worker(source, { eval: true });
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      worker.terminate();
      reject(new Error(`no result in ${GUARD_MS} ms`));
    }, GUARD_MS);
    worker.once("message", (message) => {
      clearTimeout(guard);
      worker.terminate();
      if (message.error) reject(new Error(message.error));
      else resolve(message.value);
    });
    worker.once("error", (error) => {
      clearTimeout(guard);
      reject(error);
    });
  });
}

const library = new URL("../src/diagnostics.js", import.meta.url).href;
const tools = new URL("../../../tools/quoted-texts.js", import.meta.url).href;
const playground = new URL("../../../playground/pipeline.js", import.meta.url);

test("the side-by-side view trims a line with a long inner run of spaces", async () => {
  const width = await guarded(`const { sideBySide } = await import(${JSON.stringify(library)});
    const line = "a" + " ".repeat(RUN) + "b";
    return sideBySide(line, line, "left", "right").split("\\n")[1].length;`);
  assert.equal(width, 2 * (RUN + 2) + 3);
});

test("the words of a quoted text with a long run of periods are found", async () => {
  const labels = await guarded(`const { wordLabels } = await import(${JSON.stringify(tools)});
    return wordLabels("a" + ".".repeat(RUN) + "b").map((label) => label.length);`);
  assert.deepEqual(labels, [RUN + 2]);
});

test("the playground finds document mentions after a long run of name characters", async () => {
  const found = await guarded(`const fs = require("node:fs"), vm = require("node:vm");
    const context = {};
    context.self = context;
    vm.runInNewContext(fs.readFileSync(${JSON.stringify(playground.pathname)}, "utf8"), context);
    return context.gencmuPipeline.documentMentions("a".repeat(RUN) + " x/y.md").map((mention) => mention.path);`);
  assert.deepEqual(found, ["x/y.md"]);
});
