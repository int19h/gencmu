#!/usr/bin/env node
// Opens the playground in a headless browser and checks that it works: its
// parser worker starts, parses a sentence under the CLL dialect into the
// expected brackets, and explains a text it rejects. With no URL the page is
// opened from file://, as someone who cloned the repository would; given a
// URL, that URL is checked instead, which is how a GitHub Pages deployment is
// tested.
//
//   node tools/smoke-playground.js [--browser chrome|firefox] [URL]
//
// The browser is driven over WebDriver with Node's built-in fetch, so there
// are no dependencies; it needs chromedriver or geckodriver, found on PATH,
// in the CHROMEWEBDRIVER or GECKOWEBDRIVER directories that GitHub's runners
// set, or given in CHROMEDRIVER or GECKODRIVER.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const args = process.argv.slice(2);
let browser = "chrome";
let target = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--browser") browser = args[++index];
  else target = args[index];
}

const drivers = {
  chrome: {
    names: [process.env.CHROMEDRIVER, "chromedriver", "chromium.chromedriver"],
    directory: process.env.CHROMEWEBDRIVER,
    file: "chromedriver",
    portFlag: (port) => [`--port=${port}`],
    capabilities: {
      browserName: "chrome",
      "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox", "--disable-gpu"] },
    },
  },
  firefox: {
    names: [process.env.GECKODRIVER, "geckodriver"],
    directory: process.env.GECKOWEBDRIVER,
    file: "geckodriver",
    portFlag: (port) => ["--port", String(port)],
    capabilities: { browserName: "firefox", "moz:firefoxOptions": { args: ["-headless"] } },
  },
};

function findExecutable(driver) {
  const candidates = [];
  if (driver.directory) candidates.push(path.join(driver.directory, driver.file));
  for (const name of driver.names.filter(Boolean)) {
    if (name.includes(path.sep)) candidates.push(name);
    else for (const dir of (process.env.PATH || "").split(path.delimiter)) candidates.push(path.join(dir, name));
  }
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(base, method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(json.value || json)}`);
  return json.value;
}

async function main() {
  const driver = drivers[browser];
  if (!driver) throw new Error(`unknown browser ${browser}`);
  const executable = findExecutable(driver);
  if (!executable) throw new Error(`no ${driver.file} found for ${browser}`);
  const port = 9515 + Math.floor(Math.random() * 1000);
  const child = spawn(executable, driver.portFlag(port), { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; ; attempt++) {
      let reason = "not ready";
      try {
        if ((await request(base, "GET", "/status")).ready) break;
      } catch (error) {
        reason = error.message;
      }
      if (attempt >= 100) throw new Error(`${driver.file} did not become ready: ${reason}`);
      await sleep(100);
    }
    const session = await request(base, "POST", "/session", {
      capabilities: { alwaysMatch: driver.capabilities },
    });
    const id = session.sessionId;
    try {
      /** Runs a script in the page and returns its value. */
      const run = (script, ...args) => request(base, "POST", `/session/${id}/execute/sync`, { script, args });
      /** Polls a script until it returns something other than null. */
      async function until(what, script, ...args) {
        let value = null;
        for (let attempt = 0; attempt < 600; attempt++) {
          value = await run(script, ...args);
          if (value !== null) return value;
          await sleep(100);
        }
        const status = await run(`return document.getElementById("status").textContent`);
        throw new Error(`timed out waiting for ${what}; the status says ${JSON.stringify(status)}`);
      }
      // The answer shown for a text, once the page has one and is idle.
      const answerFor = (text) => until(`the answer for ${JSON.stringify(text)}`, `
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        if (status.dataset.state === "error") return { error: status.textContent };
        if (status.dataset.state !== "ready" || result.dataset.for !== arguments[0] || result.hasAttribute("aria-busy")) return null;
        const output = document.querySelector("#output pre");
        const explanation = document.getElementById("explanation");
        return { output: output ? output.textContent : "", explanation: explanation ? explanation.textContent : "",
                 verdict: document.querySelector("#summary .badge").textContent };`, text);
      const type = (text) => run(`
        const input = document.getElementById("input");
        input.value = arguments[0];
        input.dispatchEvent(new Event("input"));`, text);

      const choose = (dialect) => run(`
        const select = document.getElementById("dialect");
        select.value = arguments[0];
        select.dispatchEvent(new Event("change"));`, dialect);

      await request(base, "POST", `/session/${id}/url`, { url: target });
      // The status is "loading" and then "busy" until the first answer,
      // which makes it "ready", or a failure, which makes it "error".
      const started = await until("the page to start", `
        const status = document.getElementById("status");
        return status && ["ready", "error"].includes(status.dataset.state) ? { state: status.dataset.state, status: status.textContent } : null;`);
      if (started.state !== "ready") throw new Error(`the playground did not become ready: ${started.status}`);
      const version = await run(`return document.getElementById("version").textContent`);
      if (!/^library \d+\.\d+\.\d+/.test(version)) throw new Error(`the worker did not report the library's version: ${version}`);

      // From here on, every answer the page shows as ready must be for the
      // text and dialect its controls hold at that moment: an answer that
      // arrives after they changed is out of date and must not be shown.
      await run(`
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
        new MutationObserver(check).observe(document.getElementById("status"), { attributes: true, childList: true, subtree: true });`);
      const stale = async () => {
        const found = await run(`return self.smokeStale`);
        if (found.length) throw new Error(`the page showed an answer for an earlier state as current: ${JSON.stringify(found[0])}`);
      };

      await choose("dialects/cll.md");
      const sentence = "mi klama le zarci";
      await type(sentence);
      const accepted = await answerFor(sentence);
      if (accepted.error) throw new Error(`the playground failed: ${accepted.error}`);
      const brackets = "(mi [klama {le zarci}])";
      if (accepted.output.trim() !== brackets) {
        throw new Error(`${sentence} under cll gave ${JSON.stringify(accepted.output)}, not ${brackets}`);
      }

      const rejected = "mi klama le le";
      await type(rejected);
      const explained = await answerFor(rejected);
      if (explained.error) throw new Error(`the playground failed: ${explained.error}`);
      if (!/rejected/.test(explained.verdict) || !/The syntax stage cannot read the text/.test(explained.explanation) ||
          !/\^/.test(explained.explanation) || !/sumti-6: .*LE/.test(explained.explanation)) {
        throw new Error(`${rejected} was not explained as a rejection: ${JSON.stringify(explained)}`);
      }

      // Texts typed while earlier ones are still being parsed, one of them
      // long enough to be parsing when the next arrives.
      const long = Array(8).fill("lo lojbo cu tavla fi lo nu mi klama le zarci .i do pu tavla mi").join(" .i ");
      for (const text of [long, "mi klama", long + " .i mi", "mi klama le zarci .i do klama", "do klama"]) {
        await type(text);
        await sleep(170 + Math.floor(Math.random() * 100));
      }
      await choose("dialects/experimental.md");
      await type("mi cu klama");
      await choose("dialects/cll.md");
      const last = "mi klama le zarci";
      await type(last);
      const settled = await answerFor(last);
      if (settled.error || settled.output.trim() !== brackets) throw new Error(`after a burst of changes: ${JSON.stringify(settled)}`);
      await stale();

      // An edited lexicon is read with the notation grammar, which takes a
      // while; a dialect that does not use it should not wait for that.
      await run(`[...document.querySelectorAll("button.doc")].find((button) => button.textContent === "words/lexicon-cll").click();
        const editor = document.getElementById("doc-text");
        editor.value = editor.value.replace("≔", "≔ ");
        editor.dispatchEvent(new Event("input"));`);
      await until("the edited lexicon to be read", `
        return document.getElementById("status").textContent.includes("Reading words/lexicon-cll") ? true : null;`);
      await choose("dialects/experimental.md");
      const other = await until("an answer under the experimental dialect", `
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        return status.dataset.state === "ready" && result.dataset.dialect === "experimental" && !result.hasAttribute("aria-busy")
          ? { read: self.playground.client.doms.has("words/lexicon-cll.md"), output: (document.querySelector("#output pre") || {}).textContent } : null;`);
      // The worker hands the page every document it finishes reading, so
      // the lexicon's being there means the switch waited for it.
      if (other.read) throw new Error("switching to a dialect that does not read the edited lexicon waited for it to be read");
      if (!other.output || !other.output.includes("klama")) throw new Error(`no brackets under experimental: ${JSON.stringify(other)}`);
      await stale();
      console.log(`playground works in ${browser} at ${target}, ${version}`);
    } finally {
      await request(base, "DELETE", `/session/${id}`).catch(() => {});
    }
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
