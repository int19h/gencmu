#!/usr/bin/env node
// Opens the playground in headless Chrome and checks that its parser worker
// answered. With no argument the page is opened from file://, as someone who
// cloned the repository would; with a URL, that URL is checked instead, which
// is how the GitHub Pages deployment is tested. No dependencies: Chrome's
// --dump-dom prints the page's DOM once it has settled.
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const candidates = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
const target = process.argv[2] || pathToFileURL(path.join(__dirname, "..", "index.html")).href;

function dump(browser) {
  return execFileSync(browser, [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    "--virtual-time-budget=10000", "--dump-dom", target,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
}

let dom;
let lastError;
for (const browser of candidates) {
  try {
    dom = dump(browser);
    break;
  } catch (error) {
    lastError = error;
  }
}
if (dom === undefined) {
  console.error(`no headless Chrome could open ${target}: ${lastError}`);
  process.exit(2);
}
const state = /id="status" data-state="([a-z]+)"/.exec(dom);
if (!state || state[1] !== "ready") {
  console.error(`the playground did not become ready at ${target}; status: ${state ? state[1] : "missing"}`);
  console.error(dom.slice(0, 2000));
  process.exit(1);
}
if (!dom.includes("&quot;ok&quot;: true") && !dom.includes('"ok": true')) {
  console.error("the worker answered, but not with a result");
  process.exit(1);
}
console.log(`playground ready at ${target}`);
