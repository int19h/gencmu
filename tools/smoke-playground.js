#!/usr/bin/env node
// Opens the playground in a headless browser and checks that it works: its
// parser worker starts, parses a sentence under the CLL dialect into the
// expected brackets, and explains a text it rejects; that "gencmu" in its
// heading links to the repository; that it lists the features a parse used
// by name; and that it never shows an out-of-date answer as current. With no
// URL the page is opened from file://, as someone who cloned the repository
// would; given a URL, that URL is checked instead, which is how a GitHub
// Pages deployment is tested.
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
    const page = await instance.newPage();
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
    console.log(`playground works in ${browser} at ${target}, ${version}`);
  } finally {
    await instance.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
