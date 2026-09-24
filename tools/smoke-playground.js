#!/usr/bin/env node
// Opens the playground in a headless browser and checks that its parser
// worker answered. With no URL the page is opened from file://, as someone
// who cloned the repository would; given a URL, that URL is checked instead,
// which is how a GitHub Pages deployment is tested.
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
      try {
        if ((await request(base, "GET", "/status")).ready) break;
      } catch (error) {
        if (attempt > 100) throw new Error(`${driver.file} did not start: ${error.message}`);
      }
      await sleep(100);
    }
    const session = await request(base, "POST", "/session", {
      capabilities: { alwaysMatch: driver.capabilities },
    });
    const id = session.sessionId;
    try {
      await request(base, "POST", `/session/${id}/url`, { url: target });
      let state;
      for (let attempt = 0; attempt < 100; attempt++) {
        state = await request(base, "POST", `/session/${id}/execute/sync`, {
          script: `const status = document.getElementById("status");
                   return { state: status && status.dataset.state, status: status && status.textContent,
                            output: (document.getElementById("output") || {}).textContent || "" };`,
          args: [],
        });
        if (state.state !== "loading") break;
        await sleep(100);
      }
      if (state.state !== "ready") {
        throw new Error(`the playground did not become ready: ${state.state}: ${state.status}`);
      }
      const result = JSON.parse(state.output);
      if (!result.ok || typeof result.version !== "string") {
        throw new Error(`the worker answered without a complete result: ${state.output}`);
      }
      console.log(`playground ready in ${browser} at ${target}, library ${result.version}`);
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
