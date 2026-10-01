#!/usr/bin/env node
// Opens the playground in a headless browser and checks that it works: its
// parser worker starts, parses a sentence under the CLL dialect into the
// expected brackets, explains a text it rejects, and shows a tie as an
// error with its two readings; that "gencmu" in its heading links to the
// repository; that it lists the features a parse used by name; that it
// never shows an out-of-date answer as current; that it shows an empty
// bracket rendering as one; that a failure for another run does not end
// the current one; and that a link to the Trace tab traces its text, or
// shows its error once. With no URL the page is opened from
// file://, as someone who cloned the repository would; given a URL, that URL
// is checked instead, which is how a GitHub Pages deployment is tested.
//
//   node tools/smoke-playground.js [--browser chrome|firefox] [URL]
//
// The browser is driven with Playwright, a development dependency of lib/js,
// and is one of Playwright's own browsers, which unlike a snap can read a
// checkout anywhere. Install them once with
//
//   cd lib/js && npm ci && npx playwright install chromium firefox
"use strict";
const { createRequire } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
let browser = "chrome";
let target = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--browser") browser = args[++index];
  else target = args[index];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadPlaywright() {
  try {
    return createRequire(path.join(__dirname, "..", "lib", "js", "package.json"))("playwright");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error("Playwright is not installed: run `npm ci` in lib/js, then `npx playwright install chromium firefox`");
  }
}

async function main() {
  const playwright = loadPlaywright();
  const engines = { chrome: playwright.chromium, firefox: playwright.firefox };
  const engine = engines[browser];
  if (!engine) throw new Error(`unknown browser ${browser}`);
  const instance = await engine.launch({ headless: true });
  try {
    let page = await instance.newPage();
    /** Runs a function in the page and returns its value. */
    const run = (script, arg) => page.evaluate(script, arg);
    /** Polls a function until it returns something other than null. */
    async function until(what, script, arg) {
      let value = null;
      for (let attempt = 0; attempt < 600; attempt++) {
        value = await run(script, arg);
        if (value !== null) return value;
        await sleep(100);
      }
      const status = await run(() => document.getElementById("status").textContent);
      throw new Error(`timed out waiting for ${what}; the status says ${JSON.stringify(status)}`);
    }
    // The answer shown for a text, once the page has one and is idle.
    const answerFor = (text) => until(`the answer for ${JSON.stringify(text)}`, (text) => {
      const status = document.getElementById("status");
      const result = document.getElementById("result");
      if (status.dataset.state === "error") return { error: status.textContent };
      if (status.dataset.state !== "ready" || result.dataset.for !== text || result.hasAttribute("aria-busy")) return null;
      const output = document.querySelector("#output pre");
      const explanation = document.getElementById("explanation");
      return { output: output ? output.textContent : "", explanation: explanation ? explanation.textContent : "",
               verdict: document.querySelector("#summary .badge").textContent };
    }, text);
    // The page once it is idle with an answer shown, or has failed, and
    // optionally once an element matches a selector.
    const idle = (what, selector) => until(what, (selector) => {
      const status = document.getElementById("status");
      if (status.dataset.state === "error") return { error: status.textContent };
      if (status.dataset.state !== "ready" || document.getElementById("result").hasAttribute("aria-busy")) return null;
      if (selector && !document.querySelector(selector)) return null;
      const output = document.querySelector("#output pre");
      return { boxes: [...document.querySelectorAll("#diagnostics .box")].map((box) => box.textContent), output: output ? output.textContent : null };
    }, selector || null);
    // A change marks the shown result stale at once, before any answer: the
    // result region is busy and the status no longer says ready. The change
    // and the check run in one evaluation, so no answer can come between.
    const change = async (what, id, value, event) => {
      const left = await run(({ id, value, event }) => {
        const control = document.getElementById(id);
        control.value = value;
        control.dispatchEvent(new Event(event));
        const status = document.getElementById("status").dataset.state;
        const busy = document.getElementById("result").getAttribute("aria-busy");
        return busy === "true" && status !== "ready" ? null : { status, busy };
      }, { id, value, event });
      if (left) throw new Error(`right after ${what} the old result was still shown as current: ${JSON.stringify(left)}`);
    };
    const type = (text) => change("typing", "input", text, "input");
    const choose = (dialect) => change("choosing a dialect", "dialect", dialect, "change");

    await page.goto(target);
    // The status is "loading" and then "busy" until the first answer, which
    // makes it "ready", or a failure, which makes it "error".
    const started = await until("the page to start", () => {
      const status = document.getElementById("status");
      return status && ["ready", "error"].includes(status.dataset.state) ? { state: status.dataset.state, status: status.textContent } : null;
    });
    if (started.state !== "ready") throw new Error(`the playground did not become ready: ${started.status}`);
    const version = await run(() => document.getElementById("version").textContent);
    // The id of every run the page sends from here on.
    await run(() => {
      const client = self.playground.client;
      const send = client.run.bind(client);
      self.smokeRunIds = [];
      client.run = (id, request) => {
        self.smokeRunIds.push(id);
        send(id, request);
      };
    });
    if (!/^library \d+\.\d+\.\d+/.test(version)) throw new Error(`the worker did not report the library's version: ${version}`);

    // The word "gencmu" in the heading links to the repository.
    const heading = await run(() => {
      const link = document.querySelector("h1 a");
      return link ? { text: link.textContent, href: link.getAttribute("href") } : null;
    });
    if (!heading || heading.text !== "gencmu" || heading.href !== "https://github.com/int19h/gencmu") {
      throw new Error(`the heading does not link gencmu to the repository: ${JSON.stringify(heading)}`);
    }

    // From here on, every answer the page shows as ready must be for the text
    // and dialect its controls hold at that moment: an answer that arrives
    // after they changed is out of date and must not be shown.
    await run(() => {
      self.smokeStale = [];
      const check = () => {
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        if (status.dataset.state !== "ready") return;
        const text = document.getElementById("input").value;
        const dialect = document.getElementById("dialect").value;
        if (result.dataset.for !== text || "dialects/" + result.dataset.dialect + ".md" !== dialect) {
          self.smokeStale.push({ shown: result.dataset.for, dialect: result.dataset.dialect, text, selected: dialect });
        }
      };
      new MutationObserver(check).observe(document.getElementById("status"), { attributes: true, childList: true, subtree: true });
    });
    const stale = async () => {
      const found = await run(() => self.smokeStale);
      if (found.length) throw new Error(`the page showed an answer for an earlier state as current: ${JSON.stringify(found[0])}`);
    };

    await choose("dialects/cll-ebnf.md");
    const sentence = "mi klama le zarci";
    await type(sentence);
    const accepted = await answerFor(sentence);
    if (accepted.error) throw new Error(`the playground failed: ${accepted.error}`);
    const brackets = "(mi [klama {le zarci}])";
    if (accepted.output.trim() !== brackets) {
      throw new Error(`${sentence} under cll-ebnf gave ${JSON.stringify(accepted.output)}, not ${brackets}`);
    }

    const rejected = "mi klama le le";
    await type(rejected);
    const explained = await answerFor(rejected);
    if (explained.error) throw new Error(`the playground failed: ${explained.error}`);
    if (!/rejected/.test(explained.verdict) || !/The syntax stage cannot read the text/.test(explained.explanation) ||
        !/\^/.test(explained.explanation) || !/sumti-6: .*LE/.test(explained.explanation)) {
      throw new Error(`${rejected} was not explained as a rejection: ${JSON.stringify(explained)}`);
    }

    // A tie is an error, shown with its two readings and no tree.
    const tied = "to mi klama";
    await choose("dialects/experimental.md");
    await type(tied);
    const tie = await answerFor(tied);
    if (tie.error) throw new Error(`the playground failed: ${tie.error}`);
    if (!/a tie in the syntax stage/.test(tie.verdict) || !/The syntax stage is ambiguous/.test(tie.explanation) ||
        !/first\(/.test(tie.explanation) || !/second\(/.test(tie.explanation) || tie.output !== "") {
      throw new Error(`${tied} was not shown as a tie: ${JSON.stringify(tie)}`);
    }

    // Texts typed while earlier ones are still being parsed, one of them long
    // enough to be parsing when the next arrives.
    const long = Array(8).fill("lo lojbo cu tavla fi lo nu mi klama le zarci .i do pu tavla mi").join(" .i ");
    for (const text of [long, "mi klama", long + " .i mi", "mi klama le zarci .i do klama", "do klama"]) {
      await type(text);
      await sleep(170 + Math.floor(Math.random() * 100));
    }
    await choose("dialects/experimental.md");
    await type("mi cu klama");
    await choose("dialects/cll-ebnf.md");
    const last = "mi klama le zarci";
    await type(last);
    const settled = await answerFor(last);
    if (settled.error || settled.output.trim() !== brackets) throw new Error(`after a burst of changes: ${JSON.stringify(settled)}`);
    await stale();

    // An empty text has a tree whose brackets are empty (docs/output.md).
    // The page shows that rendering, with its Copy button, and does not say
    // that there is no tree. It says only that the rendering is empty.
    const emptyRendering = async (what) => {
      const answer = await answerFor("");
      if (answer.error) throw new Error(`the playground failed: ${answer.error}`);
      const empty = await run(() => ({
        pre: document.querySelector("#output pre.result-text") ? document.querySelector("#output pre.result-text").textContent : null,
        copy: !!document.querySelector("#output .copy-row button"),
        text: document.getElementById("output").textContent,
      }));
      if (empty.pre !== "" || !empty.copy || /No tree|no tokens/.test(empty.text) || !/The bracket rendering is empty/.test(empty.text)) {
        throw new Error(`the empty bracket rendering of ${what} was not shown as one: ${JSON.stringify(empty)}`);
      }
    };
    await type("");
    await emptyRendering("a hollow tree");

    // A token's label can be empty too (docs/output.md), so an empty
    // rendering does not mean that the tree holds no tokens. In this
    // pipeline the first stage emits one token X with an empty label for the
    // empty text, and the second stage reads it.
    const labelless = "dialects/zantufa.md";
    await run((path) => self.playground.client.setDocument(path, "# Empty labels\n\n```jbogenbau\n" +
      "%stage a\n%ambiguity-resolution greedy\n%rule text ε\n%emits X\n" +
      "%stage b\n%ambiguity-resolution greedy\n%rule text X\n```\n"), labelless);
    await choose(labelless);
    await emptyRendering("a token with an empty label");
    const shownFor = await run(() => document.getElementById("result").dataset.dialect);
    if (shownFor !== "zantufa") throw new Error(`the empty label was checked under ${shownFor}, not the edited pipeline`);
    await run((path) => self.playground.client.setDocument(path, self.gencmuGrammars[path]), labelless);
    await choose("dialects/cll-ebnf.md");
    await type(last);
    await answerFor(last);

    // An edited document is read with the notation grammar, which takes a
    // while for a long one such as the CLL word shapes; a dialect that does
    // not use it should not wait for that.
    await run(() => {
      [...document.querySelectorAll("button.doc")].find((button) => button.textContent === "words/shapes").click();
      const editor = document.getElementById("doc-text");
      editor.value = editor.value.replace("%rule", "%rule ");
      editor.dispatchEvent(new Event("input"));
    });
    await until("the edited word shapes to be read", () =>
      document.getElementById("status").textContent.includes("Reading words/shapes") ? true : null);
    await choose("dialects/experimental.md");
    const other = await until("an answer under the experimental dialect", () => {
      const status = document.getElementById("status");
      const result = document.getElementById("result");
      return status.dataset.state === "ready" && result.dataset.dialect === "experimental" && !result.hasAttribute("aria-busy")
        ? { read: self.playground.client.doms.has("words/shapes.md"), output: (document.querySelector("#output pre") || {}).textContent } : null;
    });
    // The worker hands the page every document it finishes reading, so the
    // document's being there means the switch waited for it.
    if (other.read) throw new Error("switching to a dialect that does not read the edited word shapes waited for them to be read");
    if (!other.output || !other.output.includes("klama")) throw new Error(`no brackets under experimental: ${JSON.stringify(other)}`);
    await stale();

    // The features a parse used are listed by name, each in its own code
    // element, and never as the text of an array.
    const featured = "je lu «lo nu spoja pu lakne je cu xoi ro da pacna na fasnu» li'u";
    await type(featured);
    const listed = await answerFor(featured);
    if (listed.error) throw new Error(`the playground failed: ${listed.error}`);
    const features = await run(() => {
      const line = document.querySelector("#summary .features-used");
      return line ? { text: line.textContent, codes: [...line.querySelectorAll("code")].map((code) => code.textContent) } : null;
    });
    const escaped = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = features && features.codes.map((name) => `${escaped(name)}(?: \\(auto\\))?`).join(", ");
    if (!features || !features.codes.length || !new RegExp(`^Features: ${named}$`).test(features.text)) {
      throw new Error(`the features used were not listed by name: ${JSON.stringify(features)}`);
    }
    await stale();

    // A failure of an earlier run can arrive after a newer run started. It
    // must not end the newer run, and its error is not shown. The worker
    // fails a run whose request is null. Here that run has the id of the
    // last run that finished, and the worker posts its failure before it
    // reads the newer run.
    const staleFailure = "mi klama le zarci .i do klama";
    const failedEarlier = await run((text) => {
      const client = self.playground.client;
      const ids = self.smokeRunIds;
      const earlier = ids[ids.length - 1];
      const input = document.getElementById("input");
      input.value = text;
      input.dispatchEvent(new Event("input"));
      client.worker.postMessage({ kind: "run", id: earlier, request: null });
      self.playground.schedule(0);
      return { earlier, newer: ids[ids.length - 1] };
    }, staleFailure);
    if (!(failedEarlier.newer > failedEarlier.earlier)) throw new Error(`the page did not start a newer run at once: ${JSON.stringify(failedEarlier)}`);
    const afterFailure = await answerFor(staleFailure);
    if (afterFailure.error) throw new Error(`a failure for another run ended the current one: ${afterFailure.error}`);
    if (!afterFailure.output.includes("klama")) throw new Error(`no brackets after a stale failure: ${JSON.stringify(afterFailure)}`);
    const boxes = await run(() => [...document.querySelectorAll("#diagnostics .box")].map((box) => box.textContent));
    if (boxes.some((box) => /went wrong/.test(box))) throw new Error(`a failure for another run was shown: ${JSON.stringify(boxes)}`);

    // A failure outside any run, here of a worker told to start with no
    // documents, stops that worker. The page says so, and the next change
    // starts a new worker.
    await run(() => self.playground.client.worker.postMessage({ kind: "init", sources: null }));
    const broken = await until("the failure outside a run", () => {
      const status = document.getElementById("status");
      return status.dataset.state === "error" ? { text: document.getElementById("diagnostics").textContent, worker: !!self.playground.client.worker } : null;
    });
    if (!/The parser worker stopped/.test(broken.text) || broken.worker) {
      throw new Error(`a failure outside a run did not stop the worker: ${JSON.stringify(broken)}`);
    }
    await type(last);
    const restarted = await answerFor(last);
    if (restarted.error || restarted.output.trim() !== brackets) throw new Error(`no new worker after a failure outside a run: ${JSON.stringify(restarted)}`);
    await stale();

    // A shared link can ask for a feature both on and off, which the library
    // refuses. On the Trace tab the page shows that error once and then
    // stays idle: it asks the worker again only when the worker says that
    // the trace waits for the dialect's stages. The link keeps both lists.
    const conflicting = "#text=mi&dialect=cll-ebnf&features=sa-su&without=sa-su&view=trace";
    page = await instance.newPage();
    await page.goto(target + conflicting);
    const refused = await idle("the refused feature selection");
    if (refused.error) throw new Error(`the playground failed: ${refused.error}`);
    if (refused.boxes.length !== 1 || !/The parser could not run/.test(refused.boxes[0]) || !/sa-su/.test(refused.boxes[0])) {
      throw new Error(`a feature both on and off was not shown as one error: ${JSON.stringify(refused)}`);
    }
    const runs = await run(() => self.playground.timings.runs.length);
    await sleep(1500);
    const after = await run(() => ({ runs: self.playground.timings.runs.length, state: document.getElementById("status").dataset.state, hash: location.hash }));
    if (after.runs !== runs || after.state !== "ready") {
      throw new Error(`the Trace tab kept asking after the error: ${runs} runs, then ${JSON.stringify(after)}`);
    }
    const kept = new URLSearchParams(after.hash.slice(1));
    if (kept.get("features") !== "sa-su" || kept.get("without") !== "sa-su") {
      throw new Error(`the link lost its feature selection: ${after.hash}`);
    }

    // A link to the Trace tab traces the text, once the worker has named
    // the dialect's stages.
    page = await instance.newPage();
    await page.goto(target + "#text=mi%20klama&dialect=cll-ebnf&view=trace");
    const traced = await idle("a trace from a link", "#trace-picker .gap");
    if (traced.error || !traced.output) throw new Error(`a link to the Trace tab gave no trace: ${JSON.stringify(traced)}`);
    console.log(`playground works in ${browser} at ${target}, ${version}`);
  } finally {
    await instance.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
