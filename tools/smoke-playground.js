#!/usr/bin/env node
// Opens the playground in a headless browser and checks that it works: its
// parser worker starts, parses a sentence under the CLL pipeline into the
// expected brackets, explains a text it rejects, and shows a tie as an
// error with its two readings; that "gencmu" in its heading links to the
// repository; that it lists the features a parse used by name; that it
// never shows an out-of-date answer as current; that it shows an empty
// bracket rendering as one; that a failure for another run does not end
// the current one; and that a link to the Trace tab traces its text, or
// shows its error once. With no URL the page is opened from
// a loopback HTTP server. A supplied URL tests an existing deployment.
// Every preset also runs through its selector. Grammar edits expose ties
// and Reset restores the bundled result.
//
//   node tools/smoke-playground.js [--browser chromium|chrome|firefox] [URL]
//
// The browser is driven with Playwright, a development dependency of lib/js,
// and is one of Playwright's own browsers, which unlike a snap can read a
// checkout anywhere. Install them once with
//
//   cd lib/js && npm ci && npx playwright install chromium firefox
"use strict";
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const http = require("node:http");

const args = process.argv.slice(2);
let browser = "chromium";
let target = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--browser") browser = args[++index];
  else target = args[index];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repository = path.resolve(__dirname, "..");
const repositoryFiles = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean));

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
  const engines = { chromium: playwright.chromium, chrome: playwright.chromium, firefox: playwright.firefox };
  const engine = engines[browser];
  if (!engine) throw new Error(`unknown browser ${browser}`);
  const instance = await engine.launch({ headless: true });
  let server;
  try {
    if (!target) {
      server = http.createServer((request,response) => {
        try {
          const pathname = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
          const file = path.resolve(repository,"." + pathname + (pathname.endsWith("/") ? "index.html" : ""));
          if (!file.startsWith(repository + path.sep)) { response.writeHead(403).end(); return; }
          const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml" };
          const text = fs.readFileSync(file);
          response.writeHead(200,{ "Content-Type":types[path.extname(file)] || "text/plain" }).end(text);
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
      target = `http://127.0.0.1:${server.address().port}/index.html`;
    }
    let page = await instance.newPage();
    /** Runs a function in the page and returns its value. */
    const run = (script, arg) => page.evaluate(script, arg);
    // The browser parses attributes and resolves generated links before this test.
    async function assertLinks() {
      const { base, links } = await run(() => ({ base: location.href,
        links: [...document.querySelectorAll("a[href]")].map((link) => link.href) }));
      const { origin, protocol } = new URL(base);
      for (const href of links) {
        const url = new URL(href);
        const pathname = decodeURIComponent(url.pathname);
        if (url.origin === origin && (url.protocol === protocol || url.protocol === "blob:") && !/\.md\/?$/i.test(pathname)) continue;
        const prefix = "/int19h/gencmu/blob/main/";
        const file = path.join(repository, pathname.slice(prefix.length));
        if (url.href === "https://github.com/int19h/gencmu") continue;
        if (url.origin === "https://github.com" && !url.username && !url.password && url.pathname === "/int19h/gencmu/issues/new") continue;
        if (url.origin === "https://github.com" && !url.username && !url.password && url.pathname.startsWith(prefix) &&
            repositoryFiles.has(pathname.slice(prefix.length)) && fs.existsSync(file) && fs.statSync(file).isFile()) continue;
        throw new Error(`invalid playground link: ${href}`);
      }
    }
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
      const output = document.querySelector("#output pre.result-text");
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
      const output = document.querySelector("#output pre") || document.getElementById("output");
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
    const editGrammar = async (what, value) => {
      const left = await run((value) => {
        self.playground.editor.editValue(value);
        const status = document.getElementById("status").dataset.state;
        const busy = document.getElementById("result").getAttribute("aria-busy");
        return busy === "true" && status !== "ready" ? null : { status, busy };
      }, value);
      if (left) throw new Error(`right after ${what} the old result was still shown as current: ${JSON.stringify(left)}`);
    };
    const type = (text) => change("typing", "input", text, "input");
    const choose = (path) => change("choosing a pipeline", "pipeline", path.replace(/^grammars\//, "").replace(/\/pipeline\.md$/, ""), "change");
    const tokenTable = () => run(() => {
      const header = [...document.querySelectorAll("#output table.tokens th")].map((cell) => cell.textContent);
      return {
        header,
        rows: [...document.querySelectorAll("#output table.tokens tbody tr")].map((row) =>
          [...row.querySelectorAll("td")].map((cell, index) => {
            if (cell.classList.contains("tags")) return [...cell.querySelectorAll(".tag")].map((tag) => tag.textContent);
            const col = header[index];
            if (col === "before" || col === "after") return JSON.parse(cell.textContent);
            return cell.textContent;
          })),
      };
    });

    await page.goto(target);
    // The status is "loading" and then "busy" until the first answer, which
    // makes it "ready", or a failure, which makes it "error".
    const started = await until("the page to start", () => {
      const status = document.getElementById("status");
      return status && ["ready", "error"].includes(status.dataset.state) ? { state: status.dataset.state, status: status.textContent } : null;
    });
    if (started.state !== "ready") throw new Error(`the playground did not become ready: ${started.status}`);
    await assertLinks();
    // Each fixture uses the same live DOM assertion as the page and presets.
    const invalidLinks = [
      ["unquoted attribute", "<a href=docs/design.md>broken</a>"],
      ["uppercase attribute", '<a HREF="docs/design.md">broken</a>'],
      ["character reference", '<a href="docs/design&#46;md">broken</a>'],
      ["setAttribute", null],
      ["GitHub raw file", "<a href=https://github.com/int19h/gencmu/raw/main/docs/design.md>broken</a>"],
      ["missing GitHub file", '<a HREF="https://github.com/int19h/gencmu/blob/main/docs/missing.md">broken</a>'],
      ["another GitHub repository", '<a href="https://github.com/int19h/another/blob/main/README.md">broken</a>'],
      ["another branch", '<a href="https://github.com/int19h/gencmu/blob/other/README.md">broken</a>'],
      ["another origin", '<a href="https://example.com/docs/design.html">broken</a>'],
      ["repository directory", '<a href="https://github.com/int19h/gencmu/blob/main/docs">broken</a>'],
    ];
    for (const [label, html] of invalidLinks) {
      const href = await run((html) => {
        const fixture = document.createElement("div");
        fixture.id = "smoke-link-fixture";
        if (html) fixture.innerHTML = html;
        else {
          const link = document.createElement("a");
          link.setAttribute("href", "docs/design.md");
          fixture.append(link);
        }
        document.body.append(fixture);
        return fixture.querySelector("a").href;
      }, html);
      let rejected = false;
      try { await assertLinks(); }
      catch (error) { rejected = error.message === `invalid playground link: ${href}`; }
      finally { await run(() => document.getElementById("smoke-link-fixture").remove()); }
      if (!rejected) throw new Error(`the link assertion allowed ${label}`);
    }
    // Local assets, rendered documents, and the editor's Blob downloads qualify.
    await run(() => {
      const fixture = document.createElement("div");
      fixture.id = "smoke-link-fixture";
      fixture.innerHTML = '<a href="playground/style.css">asset</a><a href="https://github.com/int19h/gencmu/blob/main/docs/notation.md#tree-patterns">document</a>';
      const download = document.createElement("a");
      download.href = URL.createObjectURL(new Blob(["grammar"]));
      download.download = "grammar.md";
      fixture.append(download);
      document.body.append(fixture);
    });
    try { await assertLinks(); }
    finally {
      await run(() => {
        const fixture = document.getElementById("smoke-link-fixture");
        URL.revokeObjectURL(fixture.querySelector("a[download]").href);
        fixture.remove();
      });
    }
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
    if (!/^Library \d+\.\d+\.\d+/.test(version)) throw new Error(`the worker did not report the library's version: ${version}`);

    // The brand title shows "gencmu" and the help menu links to the repository.
    const heading = await run(() => {
      const title = document.querySelector("#brand-title .g");
      const link = document.querySelector('#help-menu a[href="https://github.com/int19h/gencmu/blob/main/README.md"]');
      return title && link ? { text: title.textContent, href: link.getAttribute("href") } : null;
    });
    if (!heading || heading.text !== "gencmu" || heading.href !== "https://github.com/int19h/gencmu/blob/main/README.md") {
      throw new Error(`the heading does not link gencmu to the repository: ${JSON.stringify(heading)}`);
    }

    const parameterProof = await run(() => {
      const g=self.gencmu;
      const source="```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule pair(@Left, @Right) @Left @Right\n%rule text = pair(\"a\", \"b\")\n```";
      const sources={...self.gencmuGrammars,"smoke-parameters.md":source};
      const pipeline=g.loadPipelineSources(sources,"smoke-parameters.md");
      const result=pipeline.parse("ab");
      const audit=g.audit(pipeline)[0];
      return {ok:result.ok,rule:result.tree.rule,children:result.tree.children.map(child=>child.kind),
        templates:audit.templates.map(item=>item.template),instances:audit.instances.map(item=>item.name)};
    });
    assert.deepEqual(parameterProof,{ok:true,rule:"text",children:["token","token"],templates:["pair"],instances:["text"]});
    console.log(`parameterized rules work in ${browser}`);

    const includeCases = JSON.parse(fs.readFileSync(path.join(repository,"tests/playground-includes.json"),"utf8"));
    const includeDocuments = await run(async cases => {
      const results = [];
      for (const item of cases) {
        results.push(await new Promise((resolve,reject) => {
          const client = new self.ParserWorker({...self.gencmuGrammars,...item.sources,"grammars/test/includes/pipeline.md":"```jbogenbau\n%include \"../../../p.md\"\n```"},message => {
            if (message.kind === "ready") client.run(1,{pipeline:"test/includes",text:"a",features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
            if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
            if (message.kind === "result") {
              const editor = self.gencmuPipeline.pipelineStages("p.md",path => client.text(path),(path, names) => client.documentDirectives.get(JSON.stringify([path, names])));
              client.stop();
              if (message.loadError || !message.parse?.ok) reject(new Error(JSON.stringify(message)));
              else resolve(editor.documents);
            }
          });
          client.start();
        }));
      }
      return results;
    },includeCases);
    assert.deepEqual(includeDocuments,includeCases.map(item => item.documents));
    console.log(`decoded include paths match the editor in ${browser}`);

    const workerTrace = await run(() => new Promise((resolve, reject) => {
      const source = '```jbogenbau\n%stage chars\n%ambiguity-resolution greedy\n%rule text "a" :: A %emits $\n%stage syntax\n%ambiguity-resolution late #·_<_Elided>\n%elision-only\n%rule text a | b | c %emits $ :: A\n%rule a (A [+T])\n%rule b (A [+T] [+T])\n%rule c (A T)\n%stage tree\n%ambiguity-resolution greedy\n%rule text A\n```\n';
      const sources = {...self.gencmuGrammars, "grammars/lojban/cll/pipeline.md":source};
      const client = new self.ParserWorker(sources, message => {
        if (message.kind === "ready") client.run(1, {pipeline:"lojban/cll", text:"a", features:[], withoutFeatures:[], until:null,
          elisionOnly:false, trace:{stage:"tree", position:0}, view:{format:"brackets"}});
        if (["failed", "crashed"].includes(message.kind)) { client.stop(); reject(new Error(message.message)); }
        if (message.kind === "result") { client.stop(); resolve(message); }
      });
      client.start();
    }));
    assert.equal(workerTrace.parse?.ok, true, JSON.stringify(workerTrace));
    assert.equal(workerTrace.trace?.stage, "tree", JSON.stringify(workerTrace));
    assert.equal(workerTrace.trace?.error, undefined, JSON.stringify(workerTrace));
    assert.match(workerTrace.trace.text, /The tree stage at position 0/);
    console.log(`worker traces preserve the elision-only choice in ${browser}`);

    const namesFetches = [];
    const namesPaths = JSON.parse(fs.readFileSync(path.join(repository,"tests/playground-names-paths.json"),"utf8"));
    const namesRoute = "**/*";
    const namesBase = new URL(".", target).pathname;
    const extraNames = "grammars/test/smoke-extra-names.txt";
    const missingNames = "grammars/test/missing-names.txt";
    await page.route(namesRoute, route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith(namesBase)) return route.continue();
      const resource = decodeURIComponent(pathname.slice(namesBase.length));
      if (!["data/unicode/unicode-names.txt", extraNames, missingNames, ...namesPaths].includes(resource)) return route.continue();
      namesFetches.push(resource);
      if (resource === "data/unicode/unicode-names.txt") return route.fulfill({ contentType:"text/plain", body:fs.readFileSync(path.join(repository,"data/unicode/unicode-names.txt"),"utf8") });
      if (namesPaths.includes(resource) || resource === extraNames) return route.fulfill({ contentType:"text/plain", body:"unicode-names 15.1.0\nname E000 SMOKE LETTER\n" });
      return route.fulfill({ status:404, body:"missing" });
    });
    const namesProof = await run(async () => {
      const g = self.gencmu;
      const block = text => "```jbogenbau\n" + text + "\n```\n";
      const source = block('%names "smoke-extra-names.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"');
      const cache = JSON.parse(self.gencmuGrammars["data/preparsed/lojban.json"]);
      cache.bundledNames["grammars/test/smoke-extra-names.txt"] = g.fnv1a64("unicode-names 15.1.0\nname E000 SMOKE LETTER\n");
      const dependencies = { "data/unicode/unicode-names.txt":cache.bundledNames["data/unicode/unicode-names.txt"], "grammars/test/smoke-extra-names.txt":cache.bundledNames["grammars/test/smoke-extra-names.txt"] };
      cache.documents = {};
      cache.documents["grammars/test/smoke-names.md"] = { hash:g.fnv1a64(source), names:dependencies, dom:{ format:49,
        rules:[{name:"text",op:"define",alternatives:[{gates:[],expr:{literal:{string:"b"}}}],conditions:[],at:[4,1]}],
        directives:[{name:"names",args:["smoke-extra-names.txt"],at:[1,1]},{name:"stage",args:["main"],at:[2,1]},
          {name:"ambiguity-resolution",steps:[{step:"greedy"}],at:[3,1]}],constants:[],classifiers:[],implications:[] } };
      const proof = (documents,text) => new Promise((resolve,reject) => {
        const client = new self.ParserWorker({...self.gencmuGrammars,...documents,"grammars/test/names/pipeline.md":block('%include "../smoke-names.md"')},message => {
          if (message.kind === "ready") client.run(1,{pipeline:"test/names",text,features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
          if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
          if (message.kind === "result") { client.stop(); resolve({ok:!!message.parse?.ok,error:message.loadError?.document || null}); }
        });
        client.start();
      });
      const cached = await proof({"grammars/test/smoke-names.md":source,"data/preparsed/test.json":JSON.stringify(cache)},"b");
      cache.documents["grammars/test/smoke-names.md"].names["grammars/test/smoke-extra-names.txt"] = "0000000000000000";
      const missed = await proof({"grammars/test/smoke-names.md":source,"data/preparsed/test.json":JSON.stringify(cache)},"\uE000");
      const custom = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"'),
        "data/unicode/unicode-names.txt":"unicode-names 15.1.0\nname E000 SMOKE LETTER\n"},"\uE000");
      const numeric = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹U+0061›"')},"a");
      const core = await proof({"grammars/test/smoke-names.md":block('%stage main\n%ambiguity-resolution greedy\n%rule text "‹NUL›"')},"\0");
      const missing = await proof({"grammars/test/smoke-names.md":block('%names "missing-names.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹LATIN SMALL LETTER A›"')},"a");
      return {cached,missed,custom,numeric,core,missing};
    });
    assert.deepEqual(namesProof,{cached:{ok:true,error:null},missed:{ok:true,error:null},custom:{ok:true,error:null},
      numeric:{ok:true,error:null},core:{ok:true,error:null},missing:{ok:false,error:missingNames}});
    assert.deepEqual(namesFetches,["data/unicode/unicode-names.txt",extraNames,"data/unicode/unicode-names.txt","data/unicode/unicode-names.txt",missingNames]);
    const pathProof = await run(async paths => {
      const results = [];
      for (const path of paths) {
        results.push(await new Promise((resolve,reject) => {
          const source = '```jbogenbau\n%names "' + path + '"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹SMOKE LETTER›"\n```';
          const client = new self.ParserWorker({...self.gencmuGrammars,"names-path.md":source,"grammars/test/names-path/pipeline.md":'```jbogenbau\n%include "../../../names-path.md"\n```'},message => {
            if (message.kind === "ready") client.run(1,{pipeline:"test/names-path",text:"\uE000",features:[],withoutFeatures:[],view:{format:"brackets",showElided:false}});
            if (message.kind === "failed" || message.kind === "crashed") { client.stop(); reject(new Error(message.message)); }
            if (message.kind === "result") {
              client.stop();
              resolve({ok:!!message.parse?.ok,stored:client.namesResources.has(path),error:message.loadError?.message || null});
            }
          });
          client.start();
        }));
      }
      return results;
    },namesPaths);
    assert.deepEqual(pathProof,namesPaths.map(() => ({ok:true,stored:true,error:null})));
    assert.deepEqual(namesFetches.slice(5),namesPaths.flatMap(path => ["data/unicode/unicode-names.txt",path]));
    await page.unroute(namesRoute);
    console.log(`lazy names fetching works in ${browser}`);

    // From here on, every answer the page shows as ready must be for the text
    // and pipeline its controls hold at that moment: an answer that arrives
    // after they changed is out of date and must not be shown.
    await run(() => {
      self.smokeStale = [];
      const check = () => {
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        if (status.dataset.state !== "ready") return;
        const text = document.getElementById("input").value;
        const pipeline = document.getElementById("pipeline").value;
        if (result.dataset.for !== text || result.dataset.pipeline !== pipeline) {
          self.smokeStale.push({ shown: result.dataset.for, pipeline: result.dataset.pipeline, text, selected: pipeline });
        }
      };
      new MutationObserver(check).observe(document.getElementById("status"), { attributes: true, childList: true, subtree: true });
    });
    const stale = async () => {
      const found = await run(() => self.smokeStale);
      if (found.length) throw new Error(`the page showed an answer for an earlier state as current: ${JSON.stringify(found[0])}`);
    };

    // Examples menu, choosing an example, the note, and the footer.
    const checkExamplesMenuFor = async (pipelinePathStr, expectedHeading, expectedCount, expectedFooter) => {
      await choose(pipelinePathStr);
      await idle(`pipeline ${expectedHeading}`);
      const menuState = await run(() => {
        const menu = document.getElementById("examples-menu");
        const heading = menu.querySelector(".mgroup")?.textContent || "";
        const items = [...menu.querySelectorAll(".exitem")].map((btn) => {
          const pill = btn.querySelector(".ex-pill");
          return {
            id: btn.dataset.exampleId,
            title: btn.querySelector(".ex-top b")?.textContent || "",
            pillText: pill?.textContent || "",
            pillAria: pill?.getAttribute("aria-label") || null,
            pillTitle: pill?.getAttribute("title") || null,
            isJoined: pill?.classList.contains("pill-joined") || false,
            hasWarnIcon: !!pill?.querySelector(".part-warn svg"),
            code: btn.querySelector("code")?.textContent || "",
          };
        });
        const foot = menu.querySelector(".ex-foot")?.textContent || null;
        return { heading, items, foot };
      });
      if (menuState.heading !== expectedHeading) {
        throw new Error(`unexpected examples heading: ${JSON.stringify(menuState.heading)} !== ${JSON.stringify(expectedHeading)}`);
      }
      if (menuState.items.length !== expectedCount) {
        throw new Error(`unexpected examples count for ${expectedHeading}: ${menuState.items.length} !== ${expectedCount}`);
      }
      if (menuState.foot !== expectedFooter) {
        throw new Error(`unexpected examples footer for ${expectedHeading}: ${JSON.stringify(menuState.foot)} !== ${JSON.stringify(expectedFooter)}`);
      }
      return menuState;
    };

    const cllMenu = await checkExamplesMenuFor(
      "grammars/lojban/cll/pipeline.md",
      "Examples for lojban/cll",
      19,
      "Other pipelines have 23 more examples."
    );
    const conflictItem = cllMenu.items.find((it) => it.id === "sa-su-feature-conflict");
    if (!conflictItem || conflictItem.pillText !== "feature conflict") {
      throw new Error(`sa-su-feature-conflict pill mismatch: ${JSON.stringify(conflictItem)}`);
    }

    const expMenu = await checkExamplesMenuFor(
      "grammars/lojban/experimental/pipeline.md",
      "Examples for lojban/experimental",
      23,
      "Other pipelines have 19 more examples."
    );
    const cgvItem = expMenu.items.find((it) => it.id === "cgv-name-warning");
    if (
      !cgvItem ||
      !cgvItem.isJoined ||
      !cgvItem.hasWarnIcon ||
      cgvItem.pillText !== "accepted" ||
      cgvItem.pillAria !== "accepted, with warnings: experimental-cgv" ||
      cgvItem.pillTitle !== "accepted, with warnings: experimental-cgv"
    ) {
      throw new Error(`cgv-name-warning pill is not the joined two-part warning pill: ${JSON.stringify(cgvItem)}`);
    }

    const ebMenu = await checkExamplesMenuFor(
      "grammars/eberban/refgram/pipeline.md",
      "Examples for eberban/refgram",
      15,
      "Other pipelines have 27 more examples."
    );
    const hyphenItem = ebMenu.items.find((it) => it.id === "hyphen-warning");
    if (
      !hyphenItem ||
      !hyphenItem.isJoined ||
      !hyphenItem.hasWarnIcon ||
      hyphenItem.pillText !== "accepted" ||
      hyphenItem.pillAria !== "accepted, with warnings: hyphen-misplaced" ||
      hyphenItem.pillTitle !== "accepted, with warnings: hyphen-misplaced"
    ) {
      throw new Error(`hyphen-warning pill is not the joined two-part warning pill: ${JSON.stringify(hyphenItem)}`);
    }

    await choose("grammars/lojban/cll/pipeline.md");
    await idle("returning to lojban/cll before example checks");

    const selectExampleById = async (id) => {
      await run((exId) => {
        const ex = self.playground.examples.find((item) => item.id === exId);
        if (!ex) throw new Error(`missing example id ${exId}`);
        self.playground.applyExample(ex);
      }, id);
    };

    // Check a-sentence: gloss + hint without open, note stays across listed pipeline switch and hides on unlisted pipeline switch.
    await selectExampleById("a-sentence");
    const sentenceAns = await answerFor("mi klama le zarci");
    if (sentenceAns.error || sentenceAns.output.trim() !== "(mi [klama {le zarci}])") {
      throw new Error(`a-sentence failed: ${JSON.stringify(sentenceAns)}`);
    }
    const sentenceNote = await run(() => ({
      hidden: document.getElementById("example-hint").hidden,
      title: document.getElementById("example-hint-title").textContent,
      gloss: document.getElementById("example-hint-gloss").textContent,
      glossHidden: document.getElementById("example-hint-gloss").hidden,
      text: document.getElementById("example-hint-text").textContent,
      textHidden: document.getElementById("example-hint-text").hidden,
      ruleHidden: document.getElementById("example-hint-rule").hidden,
    }));
    if (
      sentenceNote.hidden ||
      sentenceNote.title !== "A sentence" ||
      sentenceNote.gloss !== "I go to the market." ||
      sentenceNote.glossHidden ||
      sentenceNote.textHidden ||
      !sentenceNote.text.includes("stages turn letters into words") ||
      !sentenceNote.ruleHidden
    ) {
      throw new Error(`a-sentence note mismatch: ${JSON.stringify(sentenceNote)}`);
    }
    await choose("grammars/lojban/experimental/pipeline.md");
    await answerFor("mi klama le zarci");
    if (await run(() => document.getElementById("example-hint").hidden)) {
      throw new Error("switching to a pipeline listed by the example hid the example note");
    }
    await choose("grammars/eberban/refgram/pipeline.md");
    await answerFor("mi klama le zarci");
    if (!(await run(() => document.getElementById("example-hint").hidden))) {
      throw new Error("switching to a pipeline not listed by the example did not hide the example note");
    }
    await choose("grammars/lojban/cll/pipeline.md");
    await answerFor("mi klama le zarci");

    const exampleChecks = [
      {
        id: "elided-terminators",
        pipeline: "lojban/cll",
        output: /⟨ku⟩[\s\S]*tavla/,
        elidedChecked: true,
      },
      {
        id: "repeated-le",
        pipeline: "lojban/cll",
        rejected: true,
        tab: "trace",
      },
      {
        id: "clause-erasure-sa",
        pipeline: "lojban/cll",
        output: /^\(mi \[citka \{lo plise\}\]\)$/,
        summary: /sa-su/,
        conditionalFeature: "sa-su",
        document: "grammars/lojban/common/stream.md",
        rule: "%rule sa-erasure",
        linkLabel: "Open common/stream.md at sa-erasure",
      },
      {
        id: "cyrillic",
        pipeline: "lojban/cll",
        output: /^\(mi \[klama \{le zarci\}\]\)$/,
        document: "grammars/lojban/cll/cyrillic.md",
        rule: "%rule cll-cyrillic-consonant :: Consonant",
        linkLabel: "Open cyrillic.md at cll-cyrillic-consonant",
      },
      {
        id: "earliest-longest-tense",
        pipeline: "lojban/cll",
        output: /^\(mi \[viska \{\(pu va\) \(\[ca gi\] do gi \[la djan\]\)\}\]\)$/,
        document: "grammars/lojban/cll/pipeline.md",
        rule: "  leftmost-longest #·simple-tense-modal, late #·_<_Elided>",
        linkLabel: "Open pipeline.md at leftmost-longest #·simple-tense-modal",
        summary: /syntax\s*resolved/,
        edit: ["leftmost-longest #·simple-tense-modal, ", ""],
        tie: true,
      },
      {
        id: "ranked-choice-connective",
        pipeline: "lojban/cll",
        output: /^\(\[lo kosta\] cu \[blabi joi ke \{xekri blanu\} ke'e\]\)$/,
        document: "grammars/lojban/cll/syntax.md",
        rule: "%rule afterthought-connection(@Group, @Unit)",
        linkLabel: "Open syntax.md at %rule afterthought-connection(@Group, @Unit)",
      },
      {
        id: "cgv-name-warning",
        pipeline: "lojban/experimental",
        output: /^\(\[\{la tokios\} cu\] \[barda tcadu\]\)$/,
        verdict: /^Accepted, 1 warning$/,
        document: "grammars/lojban/experimental/stream.md",
        rule: "%rule experimental-cgv",
        linkLabel: "Open stream.md at experimental-cgv",
      },
      {
        id: "me-prefers-sumti",
        pipeline: "lojban/experimental",
        tab: "tree",
        output: /me-unit\n\s+ME "me"\n\s+sumti/,
        document: "grammars/lojban/experimental/syntax.md",
        rule: "%rule me-unit",
        linkLabel: "Open syntax.md at me-unit",
        edit: ["%conditions\n  ¬$m.without-elision.parse(sumti)", ""],
        tie: true,
      },
      {
        id: "right-grouped-chain",
        pipeline: "eberban/refgram",
        output: /^\(a \[mi \{dona \(tcu mian\)\}\]\)$/,
        document: "grammars/eberban/refgram/syntax.md",
        rule: "%rule chain",
        linkLabel: "Open syntax.md at chain",
      },
      {
        id: "hyphen-warning",
        pipeline: "eberban/refgram",
        verdict: /^Accepted, 1 warning$/,
        document: "grammars/eberban/refgram/morphology.md",
        rule: "%rule hyphen-misplaced",
        linkLabel: "Open morphology.md at hyphen-misplaced",
      },
    ];

    for (const check of exampleChecks) {
      await choose(`grammars/${check.pipeline}/pipeline.md`);
      await idle(`pipeline ${check.pipeline}`);
      await page.locator(`#examples-menu button[data-example-id="${check.id}"]`).evaluate((btn) => btn.click());
      const text = await page.locator("#input").inputValue();
      const answer = await answerFor(text);
      await assertLinks();
      if (answer.error) throw new Error(`${check.id}: ${answer.error}`);
      if (check.verdict) {
        if (!check.verdict.test(answer.verdict)) {
          throw new Error(`${check.id}: unexpected verdict ${JSON.stringify(answer)}`);
        }
      } else if (check.rejected ? !/Rejected by syntax/.test(answer.verdict) : !/^Accepted/.test(answer.verdict)) {
        throw new Error(`${check.id}: unexpected verdict ${JSON.stringify(answer)}`);
      }
      if (check.elidedChecked !== undefined) {
        const isChecked = await page.locator("#show-elided").isChecked();
        if (isChecked !== check.elidedChecked) {
          throw new Error(`${check.id}: expected #show-elided=${check.elidedChecked}, got ${isChecked}`);
        }
      }
      if (check.tab) {
        const activeTab = await run(() => document.querySelector('#view-tabs .tab[aria-selected="true"]')?.dataset.view);
        if (activeTab !== check.tab) {
          throw new Error(`${check.id}: expected tab ${check.tab}, got ${activeTab}`);
        }
      }
      if (check.output && !check.output.test(answer.output.trim())) {
        throw new Error(`${check.id}: unexpected output ${answer.output}`);
      }
      const summary = await page.locator("#summary").textContent();
      if (check.summary && !check.summary.test(summary)) {
        throw new Error(`${check.id}: unexpected summary ${summary}`);
      }
      if (check.conditionalFeature) {
        await page.locator("#options-button").click();
        const group = page.locator(`#features [role="radiogroup"][aria-label="${check.conditionalFeature}"]`);
        if ((await group.locator('button[data-value="grammar"]').getAttribute("aria-checked")) !== "true") {
          throw new Error("a conditional feature does not follow its grammar initially");
        }
        await group.locator('button[data-value="off"]').click();
        const disabled = await answerFor(text);
        if (
          !/required feature sa-su is disabled/.test(disabled.verdict) ||
          !/words.*requires disabled feature sa-su/.test(disabled.explanation)
        ) {
          throw new Error(`the disabled required feature was not reported: ${JSON.stringify(disabled)}`);
        }
        await group.locator('button[data-value="on"]').click();
        const enabled = await answerFor(text);
        if (!/^Accepted/.test(enabled.verdict)) throw new Error("a caller-enabled feature did not parse");
        await group.locator('button[data-value="grammar"]').click();
        const restored = await answerFor(text);
        if (!/^Accepted/.test(restored.verdict)) throw new Error("the grammar did not restore its conditional feature");
        await page.locator("#options-button").click();
      }
      if (check.document) {
        const opened = await run(() => {
          const cur = self.playground.editor.getCursor();
          return {
            path: document.getElementById("doc-path").textContent,
            line: cur.lineText,
            linkText: document.getElementById("example-hint-rule").textContent,
          };
        });
        if (opened.path !== check.document || opened.line !== check.rule) {
          throw new Error(`${check.id}: the editor did not open the relevant rule: ${JSON.stringify(opened)}`);
        }
        if (check.linkLabel && opened.linkText !== check.linkLabel) {
          throw new Error(`${check.id}: unexpected note link label: ${JSON.stringify(opened.linkText)} !== ${JSON.stringify(check.linkLabel)}`);
        }
      }
      if (check.edit) {
        const source = await run(() => self.playground.editor.getValue());
        if (!source.includes(check.edit[0])) throw new Error(`${check.id}: the suggested edit is absent`);
        await editGrammar("editing a grammar", source.replaceAll(check.edit[0], check.edit[1]));
        const edited = await answerFor(text);
        if (edited.error || (check.tie && !/Tie in syntax/.test(edited.verdict))) {
          throw new Error(`${check.id}: the edit did not show its claimed effect: ${JSON.stringify(edited)}`);
        }
        await page.locator("#doc-reset").click();
        const reset = await answerFor(text);
        if (!check.output.test(reset.output.trim())) throw new Error(`${check.id}: reset did not restore the result`);
      }
      await assertLinks();
      console.log(`example works in ${browser}: ${check.id}`);
    }

    // Example state transitions:
    // 1. A Trace example's position label is at the rejection after another example (digits-in-cll -> repeated-le).
    await choose("grammars/lojban/cll/pipeline.md");
    await idle("lojban/cll before example state transitions");
    await selectExampleById("digits-in-cll");
    await answerFor("mi ponse 2 gerku");
    await selectExampleById("repeated-le");
    await answerFor("mi klama le le");
    const traceAfterExample = await run(() => ({
      stage: document.querySelector('.trace-stage-segs button[aria-checked="true"]')?.textContent || "",
      label: document.querySelector(".trace-pos-label")?.textContent || "",
    }));
    if (traceAfterExample.stage !== "syntax" || traceAfterExample.label !== 'Position 4, after "le" and before the end') {
      throw new Error(`Trace example did not open at its rejection position after another example: ${JSON.stringify(traceAfterExample)}`);
    }

    // 2. A Tokens example shows the last stage after selecting phonemes.
    await page.locator('#view-tabs [role="tab"][data-view="tokens"]').click();
    await idle("tokens view before selecting phonemes", "#token-stage-segs button");
    await page.locator("#token-stage-segs button").filter({ hasText: /^phonemes \(/ }).click();
    await idle("phonemes token stage selected");
    await selectExampleById("quotes-and-compounds");
    await answerFor(".alfa. bu sinxa zoi gy. α .gy. pe lo cmaci zei ciste");
    const tokenStageAfterExample = await run(() =>
      document.querySelector('#token-stage-segs button[aria-checked="true"]')?.textContent || ""
    );
    if (!/^words \(/.test(tokenStageAfterExample)) {
      throw new Error(`Tokens example did not reset token stage to the default stage after phonemes: ${JSON.stringify(tokenStageAfterExample)}`);
    }

    // 3. A rule example keeps its cursor line after another example, and editing text does not snap the cursor back.
    await selectExampleById("clause-erasure-sa");
    await answerFor("mi citka lo badna sa lo plise");
    await selectExampleById("cyrillic");
    await answerFor("ми клама ле зарши");
    const ruleLineAfterExample = await run(() => ({
      path: document.getElementById("doc-path").textContent,
      line: self.playground.editor.getCursor().lineText,
    }));
    if (
      ruleLineAfterExample.path !== "grammars/lojban/cll/cyrillic.md" ||
      ruleLineAfterExample.line !== "%rule cll-cyrillic-consonant :: Consonant"
    ) {
      throw new Error(`rule example did not keep its cursor line after another example: ${JSON.stringify(ruleLineAfterExample)}`);
    }
    await run(() => self.playground.editor.goTo(1, 1));
    await type("mi klama");
    await answerFor("mi klama");
    const lineAfterTyping = await run(() => self.playground.editor.getCursor().line);
    if (lineAfterTyping !== 1) {
      throw new Error(`typing after a rule example snapped the editor cursor away from line 1: ${lineAfterTyping}`);
    }

    // 4. A rejection that also carries %error diagnostics shows both boxes (eberban/refgram pair-voiceness).
    await choose("grammars/eberban/refgram/pipeline.md");
    await idle("eberban/refgram for rejection with %error");
    const eberbanRej = "a mi pban bure di 3 ji meon";
    await type(eberbanRej);
    await answerFor(eberbanRej);
    const eberbanBoxes = await run(() =>
      [...document.querySelectorAll("#diagnostics .box")].map((b) => b.textContent)
    );
    if (
      eberbanBoxes.length < 2 ||
      !eberbanBoxes.some((b) => b.includes("The syntax stage cannot read the text")) ||
      !eberbanBoxes.some((b) => b.includes("pair-voiceness"))
    ) {
      throw new Error(`rejection with %error did not show both boxes: ${JSON.stringify(eberbanBoxes)}`);
    }

    // Format 15 separates original text, normalized values and images.
    // Attachments keep all token fields except span, at every depth.
    await choose("grammars/lojban/cll/pipeline.md");
    const tokenText = "ba'e m,I ui nai klAma";
    await type(tokenText);
    await answerFor(tokenText);
    await page.locator("#tab-tokens").click();
    await idle("the token stage selector", "#token-stage-segs button");
    await page.locator("#token-stage-segs button").filter({hasText: /^indicators \(/}).click();
    await idle("the indicators token table", "#output table.tokens");
    const miTags = ["Cmavo", "Continued", "Final-Stress", "Initial-Stress", "KOhA", "Onset", "Run-Final", "Run-Initial", "Word"];
    const klamaTags = ["BRIVLA", "Continued", "Gismu", "Initial-Stress", "Onset", "Run-Final", "Run-Initial", "Stress-Guard", "Word"];
    const beforeTokens = [{text: "ba'e", value: "ba'e", image: "ba'e",
      tags: ["BAhE", "Cmavo", "Continued", "Onset", "Run-Final", "Run-Initial", "Word"], source: [0, 4]}];
    const afterTokens = [{text: "ui", value: "ui", image: "ui",
      tags: ["Cmavo", "Continued", "Indicator", "Run-Final", "Run-Initial", "UI", "Word"], source: [9, 11],
      after: [{text: "nai", value: "nai", image: "nai",
        tags: ["Cmavo", "Continued", "NAI", "Onset", "Run-Final", "Run-Initial", "Word"], source: [12, 15]}]}];
    assert.deepEqual(await tokenTable(), {
      header: ["#", "text", "value", "image", "span", "source", "before", "after"],
      rows: [
        ["0", '"m,I"', '"mi"', '"mI"', "1–2", "5–8", beforeTokens, afterTokens, miTags],
        ["1", '"klAma"', '"klama"', '"klAma"', "4–5", "16–21", [], [], klamaTags],
      ],
    }, "the token table must show format 15 fields, omit empty columns, and show recursive attachments");
    await page.locator("#tab-tree").click();
    const imageTree = await idle("the tree with images");
    assert.match(imageTree.output, /KOhA "mI"\n\s+◂ BAhE "ba'e"\n\s+▸ UI "ui"\n\s+▸ NAI "nai"/);
    await page.locator("#tab-json").click();
    const imageDisplay = JSON.parse((await idle("the display JSON with images")).output);
    const displayNodes = [imageDisplay];
    let attached = null;
    while (displayNodes.length) {
      const node = displayNodes.pop();
      if (!node || typeof node !== "object") continue;
      if (node.terminal === "KOhA") attached = node;
      for (const child of Object.values(node)) displayNodes.push(child);
    }
    assert.deepEqual(attached, {terminal: "KOhA", image: "mI",
      before: [{classes: ["BAhE"], image: "ba'e"}],
      after: [{classes: ["UI"], image: "ui", after: [{classes: ["NAI"], image: "nai"}]}]},
      "display JSON must render images and nested attachments");
    await page.locator("#show-canonical").check();
    const canonical = JSON.parse((await idle("the canonical JSON with values and images")).output);
    assert.equal(canonical.format, 17);
    const indicator = canonical.stages.find((stage) => stage.name === "indicators").output[0];
    assert.deepEqual(indicator, {text: "m,I", value: "mi", image: "mI", tags: miTags,
      span: [1, 2], source: [5, 8], before: beforeTokens, after: afterTokens});
    await page.locator("#show-canonical").uncheck();
    await page.locator("#tab-brackets").click();
    await idle("the brackets after the token assertions");
    console.log(`format 15 token and tree views work in ${browser}`);
    // Rule navigation uses the reader's exact definitions and active documents.
    await choose("grammars/lojban/zantufa/pipeline.md");
    await idle("switching to lojban/zantufa for rule navigation");
    const navigationText = "lo mlatu pe mi cu .feliks.";
    const navigationOutput = "([lo {mlatu (pe mi)}] cu feliks)";
    const setNavigationCase = (kind) => run((kind) => {
      const client = self.playground.client;
      const syntax = self.gencmuGrammars["grammars/lojban/zantufa/syntax.md"];
      const pipeline = self.gencmuGrammars["grammars/lojban/zantufa/pipeline.md"];
      let changed = syntax;
      let changedPipeline = pipeline;
      const marker = "%rule tanru-unit-1\n";
      if (kind === "prefix") changed = "%rule tanru-unit-1 \"prose\"\n\n" + syntax.replace(marker, "%rule tanru-unit-10 \"w\"\n" + marker);
      else if (kind === "renamed") changed = syntax.replaceAll("tanru-unit-1", "renamed-unit");
      else if (kind === "moved") {
        const start = syntax.indexOf(marker);
        const end = syntax.indexOf("\n%rule ", start + marker.length);
        if (start < 0 || end < 0) throw new Error("the navigation fixture cannot find the rule body");
        changed = syntax.slice(0, start) + syntax.slice(end);
        changedPipeline += "\n```jbogenbau\n" + syntax.slice(start, end) + "\n```\n";
      }
      client.setDocument("grammars/lojban/zantufa/syntax.md", changed);
      client.setDocument("grammars/lojban/zantufa/pipeline.md", changedPipeline);
    }, kind);
    for (const kind of ["prefix", "renamed", "moved", "reset"]) {
      await setNavigationCase(kind);
      await selectExampleById("cmevla-as-selbri");
      const answer = await answerFor(navigationText);
      if (answer.error || answer.output.trim() !== navigationOutput) {
        throw new Error(`${kind} rule navigation changed the preset result: ${JSON.stringify(answer)}`);
      }
      const opened = await run(() => {
        const cur = self.playground.editor.getCursor();
        const hint = document.getElementById("example-hint");
        return { path: document.getElementById("doc-path").textContent, offset: cur.offset,
          line: cur.lineText, hint: hint.hidden ? "" : hint.textContent };
      });
      if (kind === "renamed") {
        if (!opened.hint.includes("Cannot find rule tanru-unit-1 in the active grammar.") || opened.offset !== 0) {
          throw new Error(`a missing rule was not explained at the document start: ${JSON.stringify(opened)}`);
        }
      } else if (opened.path !== (kind === "moved" ? "grammars/lojban/zantufa/pipeline.md" : "grammars/lojban/zantufa/syntax.md") ||
          opened.line !== "%rule tanru-unit-1" || opened.hint.includes("Cannot find rule")) {
        throw new Error(`${kind} rule navigation missed the exact definition: ${JSON.stringify(opened)}`);
      }
      await assertLinks();
    }
    console.log(`playground regression cases work in ${browser}`);
    await page.locator("#tab-brackets").click();

    await choose("grammars/lojban/cll/pipeline.md");
    const sentence = "mi klama le zarci";
    await type(sentence);
    const accepted = await answerFor(sentence);
    if (accepted.error) throw new Error(`the playground failed: ${accepted.error}`);
    const brackets = "(mi [klama {le zarci}])";
    if (accepted.output.trim() !== brackets) {
      throw new Error(`${sentence} under lojban/cll gave ${JSON.stringify(accepted.output)}, not ${brackets}`);
    }

    const rejected = "mi klama le le";
    await type(rejected);
    const explained = await answerFor(rejected);
    if (explained.error) throw new Error(`the playground failed: ${explained.error}`);
    if (!/Rejected by syntax/.test(explained.verdict) || !/The syntax stage cannot read the text/.test(explained.explanation) ||
        !/\^/.test(explained.explanation) || !/sumti-6: .*LE/.test(explained.explanation)) {
      throw new Error(`${rejected} was not explained as a rejection: ${JSON.stringify(explained)}`);
    }

    const pipelineGroups = await run(() => [...document.querySelectorAll("#pipeline optgroup")].map((group) => ({
      label: group.label,
      names: [...group.children].map((option) => option.value),
    })));
    assert.deepEqual(pipelineGroups, [
      { label: "lojban", names: ["lojban/cll", "lojban/bpfk", "lojban/experimental", "lojban/zantufa", "lojban/examples/kihei"] },
      { label: "eberban", names: ["eberban/refgram"] },
      { label: "gencmu", names: ["gencmu/jbogenbau"] },
    ]);

    const kiheiLabel = await run(() => document.querySelector('#pipeline option[value="lojban/examples/kihei"]').textContent);
    if (kiheiLabel !== "lojban/examples/kihei: Discourse frames (ki'ei)") throw new Error(`unexpected kihei title: ${kiheiLabel}`);
    await choose("grammars/lojban/examples/kihei/pipeline.md");
    const saFrame = "broda .i ki'ei ko'a sa ki'ei ko'e .i brode";
    await type(saFrame);
    const frameAnswer = await answerFor(saFrame);
    if (frameAnswer.error || frameAnswer.output.trim() !== "([broda i] [{ki'ei ko'e} i brode])") {
      throw new Error(`KIhEI word erasure failed: ${JSON.stringify(frameAnswer)}`);
    }

    // Discarded source still needs to parse and remains editable from its error link.
    const patched = "grammars/lojban/zantufa/pipeline.md";
    const discarded = "grammars/lojban/common/latin.md";
    const extended = "grammars/lojban/zantufa/syntax.md";
    await run(({patched, discarded, extended}) => {
      self.playground.client.setDocument(discarded, "```jbogenbau\n%rule text (\n```\n");
      self.playground.client.setDocument(extended, "```jbogenbau\n%extend-rule text \"b\" :: X %emits $\n```\n");
      self.playground.client.setDocument(patched, "```jbogenbau\n%stage a\n%include \"../common/latin.md\"\n" +
        "%stage b\n%ambiguity-resolution greedy\n%rule text X\n%redefine-stage a\n" +
        "%ambiguity-resolution greedy\n%rule text \"a\" :: X %emits $\n%extend-stage a\n" +
        "%include \"syntax.md\"\n```\n");
    }, {patched, discarded, extended});
    await choose(patched);
    await type("b");
    await idle("the error in discarded source");
    const errorLink = page.locator('#diagnostics button.link').filter({hasText: "grammars/lojban/common/latin.md"}).first();
    await errorLink.click();
    const openedDiscarded = await run(() => document.getElementById("doc-path").textContent);
    if (openedDiscarded !== discarded) throw new Error(`discarded source did not open: ${openedDiscarded}`);
    await editGrammar("repairing discarded source", "```jbogenbau\n%rule old \"x\"\n```\n");
    const repaired = await answerFor("b");
    if (repaired.error || repaired.output.trim() !== "b") throw new Error(`stage patch failed: ${JSON.stringify(repaired)}`);
    const groups = await run(() => [...document.querySelectorAll(".doc-group")].map(group => ({
      name: group.querySelector(".doc-stage").textContent, text: group.textContent,
    })));
    if (!groups.some(group => group.name === "a" && group.text.includes("syntax")) ||
        groups.some(group => group.name === "a" && group.text.includes("common/latin"))) {
      throw new Error(`wrong stage contributions: ${JSON.stringify(groups)}`);
    }
    await run(paths => paths.forEach(path => self.playground.client.setDocument(path, self.gencmuGrammars[path])),
      [patched, discarded, extended]);
    await choose("grammars/lojban/cll/pipeline.md");
    console.log(`stage patches and KIhEI work in ${browser}`);

    // A tie is an error, shown with its two readings and no tree. No text
    // ties in a bundled pipeline, so an edited pipeline stands in for one: its
    // stage syntax reads "w" as either of two rules.
    const tiedPipeline = "grammars/lojban/zantufa/pipeline.md";
    await run((path) => self.playground.client.setDocument(path, "# A tie\n\n```jbogenbau\n" +
      "%stage syntax\n%ambiguity-resolution greedy\n%rule text a | b\n%rule a \"w\"\n%rule b \"w\"\n```\n"), tiedPipeline);
    await choose(tiedPipeline);
    const tied = "w";
    await type(tied);
    const tie = await answerFor(tied);
    if (tie.error) throw new Error(`the playground failed: ${tie.error}`);
    if (!/Tie in syntax/.test(tie.verdict) || !/The syntax stage is ambiguous/.test(tie.explanation) ||
        !/first/i.test(tie.explanation) || !/second/i.test(tie.explanation) || tie.output !== "") {
      throw new Error(`${tied} was not shown as a tie: ${JSON.stringify(tie)}`);
    }
    await run((path) => self.playground.client.setDocument(path, self.gencmuGrammars[path]), tiedPipeline);
    await choose("grammars/lojban/experimental/pipeline.md");

    // Texts typed while earlier ones are still being parsed, one of them long
    // enough to be parsing when the next arrives.
    const long = Array(8).fill("lo lojbo cu tavla fi lo nu mi klama le zarci .i do pu tavla mi").join(" .i ");
    for (const text of [long, "mi klama", long + " .i mi", "mi klama le zarci .i do klama", "do klama"]) {
      await type(text);
      await sleep(170 + Math.floor(Math.random() * 100));
    }
    await choose("grammars/lojban/experimental/pipeline.md");
    await type("mi cu klama");
    await choose("grammars/lojban/cll/pipeline.md");
    const last = "mi klama le zarci";
    await type(last);
    const settled = await answerFor(last);
    if (settled.error || settled.output.trim() !== brackets) throw new Error(`after a burst of changes: ${JSON.stringify(settled)}`);
    await stale();

    // An empty text has a tree whose brackets are empty (docs/output.md).
    // When there is no output to copy, the page hides Elided and Copy and
    // shows "The text is empty." as .empty-out without saying there is no tree.
    const emptyRendering = async (what) => {
      const answer = await answerFor("");
      if (answer.error) throw new Error(`the playground failed: ${answer.error}`);
      const empty = await run(() => ({
        pre: document.querySelector("#output pre.result-text") ? document.querySelector("#output pre.result-text").textContent : null,
        copy: !document.getElementById("copy-output")?.hidden,
        elided: !document.getElementById("elided-toggle")?.hidden,
        text: document.getElementById("output").textContent,
      }));
      if (empty.pre !== null || empty.copy || empty.elided || /No tree|no tokens/.test(empty.text) || empty.text.trim() !== "The text is empty.") {
        throw new Error(`the empty bracket rendering of ${what} was not shown as one: ${JSON.stringify(empty)}`);
      }
    };
    await type("");
    await emptyRendering("a hollow tree");

    // A token's image can be empty too (docs/output.md), so an empty
    // rendering does not mean that the tree holds no tokens. In this
    // pipeline the first stage emits one token X with an empty image for the
    // empty text, and the second stage reads it.
    const imageless = "grammars/lojban/zantufa/pipeline.md";
    await run((path) => self.playground.client.setDocument(path, "# Empty images\n\n```jbogenbau\n" +
      "%stage a\n%ambiguity-resolution greedy\n%rule text ε\n%emits ε :: X\n" +
      "%stage b\n%ambiguity-resolution greedy\n%rule text X\n```\n"), imageless);
    await choose(imageless);
    await emptyRendering("a token with an empty image");
    const shownFor = await run(() => document.getElementById("result").dataset.pipeline);
    if (shownFor !== "lojban/zantufa") throw new Error(`the empty image was checked under ${shownFor}, not the edited pipeline`);
    await page.locator("#tab-tokens").click();
    await idle("the inserted token table", "#output table.tokens");
    assert.deepEqual(await tokenTable(), {
      header: ["#", "text", "value", "image", "span", "source", "insertedBy"],
      rows: [["0", '""', '""', '""', "0–0", "0–0", "text", ["X"]]],
    }, "the token table must keep empty values and images, show insertedBy, and omit empty columns");
    await page.locator("#tab-brackets").click();
    await idle("the empty brackets after the inserted token assertion");
    await run((path) => self.playground.client.setDocument(path, self.gencmuGrammars[path]), imageless);
    await choose("grammars/lojban/cll/pipeline.md");
    await type(last);
    await answerFor(last);

    // An edited document is read with the notation grammar, which takes a
    // while for a long one such as the CLL word shapes; a pipeline that does
    // not use it should not wait for that.
    await run(() => {
      [...document.querySelectorAll("button.doc")].find((button) => button.dataset.doc === "grammars/lojban/cll/shapes.md").click();
      const ed = self.playground.editor;
      ed.editValue(ed.getValue().replace("%rule", "%rule "));
    });
    await until("the edited word shapes to be read", () =>
      document.getElementById("status").textContent.includes("Reading shapes.md") ? true : null);
    await choose("grammars/lojban/experimental/pipeline.md");
    const other = await until("an answer under the experimental pipeline", () => {
      const status = document.getElementById("status");
      const result = document.getElementById("result");
      return status.dataset.state === "ready" && result.dataset.pipeline === "lojban/experimental" && !result.hasAttribute("aria-busy")
        ? { read: self.playground.client.doms.has("grammars/lojban/cll/shapes.md"), output: (document.querySelector("#output pre") || {}).textContent } : null;
    });
    // The worker hands the page every document it finishes reading, so the
    // document's being there means the switch waited for it.
    if (other.read) throw new Error("switching to a pipeline that does not read the edited word shapes waited for them to be read");
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
    const named = features && features.codes.map((name) => `${escaped(name)}`).join("");
    if (!features || !features.codes.length || !new RegExp(`^Enabled features${named}$`).test(features.text)) {
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
    if (boxes.some((box) => /went wrong|The parser stopped/.test(box))) throw new Error(`a failure for another run was shown: ${JSON.stringify(boxes)}`);

    // A failure outside any run, here of a worker told to start with no
    // documents, stops that worker. The page says so, and the next change
    // starts a new worker.
    await run(() => self.playground.client.worker.postMessage({ kind: "init", sources: null }));
    const broken = await until("the failure outside a run", () => {
      const status = document.getElementById("status");
      return status.dataset.state === "error" ? { text: document.getElementById("diagnostics").textContent, worker: !!self.playground.client.worker } : null;
    });
    if (!/The parser stopped/.test(broken.text) || broken.worker) {
      throw new Error(`a failure outside a run did not stop the worker: ${JSON.stringify(broken)}`);
    }
    await type(last);
    const restarted = await answerFor(last);
    if (restarted.error || restarted.output.trim() !== brackets) throw new Error(`no new worker after a failure outside a run: ${JSON.stringify(restarted)}`);
    await stale();

    // A shared link can ask for a feature both on and off, which the library
    // refuses. On the Trace tab the page shows that error once and then
    // stays idle: it asks the worker again only when the worker says that
    // the trace waits for the pipeline's stages. The link keeps both lists.
    const conflicting = "#text=mi&pipeline=lojban/cll&features=sa-su&without=sa-su&view=trace";
    page = await instance.newPage();
    await page.goto(target + conflicting);
    const refused = await idle("the refused feature selection");
    await assertLinks();
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
    // the pipeline's stages.
    page = await instance.newPage();
    await page.goto(target + "#text=mi%20klama&pipeline=lojban/cll&view=trace");
    const traced = await idle("a trace from a link", "#trace-picker .gap");
    await assertLinks();
    if (traced.error || !traced.output) throw new Error(`a link to the Trace tab gave no trace: ${JSON.stringify(traced)}`);

    // The redesigned layout controls work: popover menus, split handle, hide
    // and show grammar, basic editor interface, and phone layout at 390 and 320.
    const layoutChecks = await run(() => {
      const helpBtn = document.getElementById("help-button");
      const helpMenu = document.getElementById("help-menu");
      helpBtn.click();
      const helpOpen = !helpMenu.hidden && helpBtn.getAttribute("aria-expanded") === "true";
      const hasPlaygroundDoc = [...helpMenu.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").endsWith("docs/playground.md"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      const helpClosed = helpMenu.hidden && helpBtn.getAttribute("aria-expanded") === "false";

      const split = document.getElementById("split-handle");
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
      const movedSplit = split.getAttribute("aria-valuenow");
      split.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
      const resetSplit = split.getAttribute("aria-valuenow");

      document.getElementById("hide-grammar").click();
      const hidden = document.getElementById("workspace").classList.contains("grammar-hidden");
      document.getElementById("show-grammar").click();
      const shownAgain = !document.getElementById("workspace").classList.contains("grammar-hidden");

      const ed = self.playground.editor;
      const expectedVariant = self.gencmuEditor === "basic" ? "basic" : "full";
      const expectedCap = expectedVariant === "full";
      const hasEditorApi =
        ed &&
        ed.variant === expectedVariant &&
        ed.capabilities?.syntaxColors === expectedCap &&
        ed.capabilities?.wrappedLineNumbers === expectedCap &&
        ed.capabilities?.marginMarks === expectedCap &&
        typeof ed.getValue === "function" &&
        typeof ed.setValue === "function" &&
        typeof ed.goTo === "function" &&
        typeof ed.markError === "function" &&
        typeof ed.clearMarks === "function" &&
        typeof ed.focus === "function";

      return { helpOpen, hasPlaygroundDoc, helpClosed, movedSplit, resetSplit, hidden, shownAgain, hasEditorApi, expectedVariant };
    });
    if (
      !layoutChecks.helpOpen ||
      !layoutChecks.hasPlaygroundDoc ||
      !layoutChecks.helpClosed ||
      layoutChecks.movedSplit !== "45" ||
      layoutChecks.resetSplit !== "35" ||
      !layoutChecks.hidden ||
      !layoutChecks.shownAgain ||
      !layoutChecks.hasEditorApi
    ) {
      throw new Error(`the redesigned layout checks failed: ${JSON.stringify(layoutChecks)}`);
    }

    // Full editor checks: syntax colors, error marks in the gutter, and Go to line:column.
    if (layoutChecks.expectedVariant === "full") {
      await run(() => {
        self.playground.openDocument("grammars/lojban/cll/syntax.md", 345, 1);
      });
      const fullTokens = await run(() => {
        const content = document.querySelector("#editor-body .cm-content");
        return {
          label: content ? content.getAttribute("aria-label") : null,
          hasK: !!document.querySelector("#editor-body .cm-content .k"),
          hasD: !!document.querySelector("#editor-body .cm-content .d"),
          hasT: !!document.querySelector("#editor-body .cm-content .t"),
          hasP: !!document.querySelector("#editor-body .cm-content .p"),
        };
      });
      if (fullTokens.label !== "syntax.md" || !fullTokens.hasK || !fullTokens.hasD || !fullTokens.hasT || !fullTokens.hasP) {
        throw new Error(`full editor syntax colors or label missing: ${JSON.stringify(fullTokens)}`);
      }
      const syntaxSource = await run(() => self.playground.editor.getValue());
      await editGrammar("introducing a grammar error in full editor", syntaxSource.replace("sumti-tail [+KU", "sumti-tali [+KU"));
      await idle("the grammar error in full editor", "#doc-error-bar:not([hidden])");
      await run(() => self.playground.editor.goTo(350, 21));
      const fullErrorMarks = await run(() => {
        const gutterErr = document.querySelector("#editor-body .cm-errorLineGutter .cm-errorLineNumber");
        const lineErr = document.querySelector("#editor-body .cm-errorLine");
        const srText = document.getElementById("editor-error-sr")?.textContent || "";
        const jumpBtn = document.getElementById("doc-error-jump");
        return {
          gutterAria: gutterErr ? gutterErr.getAttribute("aria-label") : null,
          hasLineErr: !!lineErr,
          srText,
          jumpText: jumpBtn ? jumpBtn.textContent : null,
        };
      });
      if (
        !fullErrorMarks.gutterAria ||
        !/, error$/.test(fullErrorMarks.gutterAria) ||
        !fullErrorMarks.hasLineErr ||
        !/^Line \d+, error:/.test(fullErrorMarks.srText) ||
        !/^Go to \d+:\d+$/.test(fullErrorMarks.jumpText || "")
      ) {
        throw new Error(`full editor error marks missing: ${JSON.stringify(fullErrorMarks)}`);
      }
      await page.locator("#doc-error-jump").click();
      const jumpedLine = await run(() => self.playground.editor.getCursor().lineText);
      if (jumpedLine !== "%rule sumti-6") {
        throw new Error(`full editor Go to line:column did not move to %rule sumti-6: ${jumpedLine}`);
      }
      await page.locator("#doc-reset").click();
      await idle("resetting full editor grammar error");
    }

    // Wrapped lines and .wrun in Tree/JSON/Audit/Trace,
    // examples menu width (380-520px) on desktop, Tokens tags second-line layout, and measured top-bar steps.
    await page.locator("#tab-tree").click();
    await idle("tree view for wrapped line check");
    const wrappedTreeCheck = await run(() => {
      const pre = document.querySelector("#output pre.result-text.code-block");
      const wlines = pre ? [...pre.querySelectorAll(".wline")] : [];
      const wruns = pre ? [...pre.querySelectorAll(".wrun")] : [];
      const brokenHyphens = wruns.filter((r) => {
        const lh = parseFloat(getComputedStyle(r).lineHeight) || 20;
        return (r.textContent || "").includes("-") && r.getBoundingClientRect().height > lh * 1.5;
      });
      const leadingSep = wruns.filter((r) => /^[›·]/.test((r.textContent || "").trim()));
      return {
        hasRawText: !!(pre && !pre.hasAttribute("data-raw-text") && typeof self.playground.getCopyOutputText() === "string" && self.playground.getCopyOutputText().length > 0),
        rawMatchesText: !!(pre && self.playground.getCopyOutputText() === pre.textContent),
        textIndent: wlines[0] ? wlines[0].style.textIndent : null,
        pad0: wlines[0] ? wlines[0].style.paddingLeft : null,
        pad1: wlines[1] ? wlines[1].style.paddingLeft : null,
        wrunCount: wruns.length,
        brokenHyphenCount: brokenHyphens.length,
        leadingSepCount: leadingSep.length,
        versionPhone: document.getElementById("version-phone")?.textContent || "",
      };
    });
    if (
      !wrappedTreeCheck.hasRawText ||
      !wrappedTreeCheck.rawMatchesText ||
      wrappedTreeCheck.textIndent !== "-4ch" ||
      wrappedTreeCheck.pad0 !== "calc(4ch)" ||
      wrappedTreeCheck.pad1 !== "calc(6ch)" ||
      wrappedTreeCheck.wrunCount === 0 ||
      wrappedTreeCheck.brokenHyphenCount !== 0 ||
      wrappedTreeCheck.leadingSepCount !== 0 ||
      !/^Library \d+\.\d+\.\d+$/.test(wrappedTreeCheck.versionPhone)
    ) {
      throw new Error(`wrapped line or phone version check failed: ${JSON.stringify(wrappedTreeCheck)}`);
    }

    await choose("grammars/lojban/experimental/pipeline.md");
    await idle("lojban/experimental for examples menu width check");
    await page.locator("#examples-button").click();
    const expMenuCheck = await run(() => {
      const menu = document.getElementById("examples-menu");
      const rect = menu.getBoundingClientRect();
      const items = [...menu.querySelectorAll(".exitem")];
      const wrapped = items.filter((btn) => btn.querySelector(".ex-top b").getClientRects().length > 1);
      const alignItems = items[0] ? getComputedStyle(items[0].querySelector(".ex-top")).alignItems : null;
      return {
        width: Math.round(rect.width),
        wrappedCount: wrapped.length,
        alignItems,
      };
    });
    if (
      expMenuCheck.width < 380 ||
      expMenuCheck.width > 520 ||
      expMenuCheck.wrappedCount !== 0 ||
      expMenuCheck.alignItems !== "flex-start"
    ) {
      throw new Error(`experimental examples menu width check failed: ${JSON.stringify(expMenuCheck)}`);
    }
    await page.keyboard.press("Escape");

    await choose("grammars/lojban/cll/pipeline.md");
    await idle("returning to lojban/cll before width checks");
    await page.locator("#tab-brackets").click();
    await idle("returning to brackets before width checks");

    for (const [w, expectedPhone, expectedStep] of [
      [1440, false, ""],
      [760, false, "1"],
      [600, false, "2"],
      [560, true, ""],
      [390, true, ""],
      [320, true, ""],
    ]) {
      await page.setViewportSize({ width: w, height: 844 });
      const m = await run(() => {
        window.dispatchEvent(new Event("resize"));
        const app = document.getElementById("app");
        const topbar = document.getElementById("topbar");
        return {
          phone: app.classList.contains("phone"),
          step: topbar.getAttribute("data-overflow") || "",
          scrollW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
        };
      });
      if (m.phone !== expectedPhone || m.step !== expectedStep || m.scrollW > m.winW) {
        throw new Error(`width check failed at ${w}px: ${JSON.stringify({ m, expectedPhone, expectedStep })}`);
      }
    }

    // At 390px phone viewport, check Tokens table tags second-line layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#tab-tokens").click();
    await idle("tokens view at 390px");
    const phoneTokCheck = await run(() => {
      const wrap = document.querySelector("#output .table-wrap");
      const table = document.querySelector("#output table.tokens");
      const thTags = table ? table.querySelector("th.tags") : null;
      const row = table ? table.querySelector("tbody tr.has-tags") : null;
      const tdText = row ? row.querySelectorAll("td")[1] : null;
      const tdTags = row ? row.querySelector("td.tags") : null;
      const rText = tdText ? tdText.getBoundingClientRect() : null;
      const rTags = tdTags ? tdTags.getBoundingClientRect() : null;
      return {
        hasThTags: !!thTags,
        textLeft: rText ? Math.round(rText.left) : null,
        tagsLeft: rTags ? Math.round(rTags.left) : null,
        textBottom: rText ? Math.round(rText.bottom) : null,
        tagsTop: rTags ? Math.round(rTags.top) : null,
        wrapClientW: wrap ? wrap.clientWidth : 0,
        wrapScrollW: wrap ? wrap.scrollWidth : 1,
      };
    });
    if (
      phoneTokCheck.hasThTags ||
      Math.abs(phoneTokCheck.tagsLeft - phoneTokCheck.textLeft) > 1 ||
      phoneTokCheck.tagsTop < phoneTokCheck.textBottom - 2 ||
      phoneTokCheck.wrapScrollW > phoneTokCheck.wrapClientW
    ) {
      throw new Error(`phone tokens table tags layout check failed: ${JSON.stringify(phoneTokCheck)}`);
    }

    // Deep nesting, Trace 5th section, Token diagnostics, and phone More actions menu:
    // 1. Deep nesting: first word of every line lies inside the pane or its scroll range,
    //    and right edge fades out while more lies to the right.
    await page.setViewportSize({ width: 1440, height: 900 });
    await choose("grammars/lojban/cll/pipeline.md");
    const deepText = "mi djuno le du'u ".repeat(7) + "do klama";
    await type(deepText);
    await answerFor(deepText);
    for (const viewName of ["tree", "json"]) {
      await page.locator(`#tab-${viewName}`).click();
      for (let attempt = 0; attempt < 600; attempt++) {
        const hasLines = await page.evaluate(() => document.querySelectorAll("#output pre.code-block .wline").length > 20);
        if (hasLines) break;
        await sleep(50);
      }
      const deepCheck = await page.evaluate(() => {
        const pre = document.querySelector("#output pre.code-block");
        if (!pre) return { ok: false, reason: "no pre" };
        pre.scrollLeft = 0;
        const preBox = pre.getBoundingClientRect();
        const style = getComputedStyle(pre);
        const lines = [...pre.querySelectorAll(".wline")];
        let outOfRange = 0;
        let maxLead = 0;
        for (const line of lines) {
          const lead = (line.querySelector(".wsp")?.textContent || "").replace(/\n/g, "").length;
          if (lead > maxLead) maxLead = lead;
          const firstRun = line.querySelector(".wrun");
          if (!firstRun) continue;
          const rBox = firstRun.getBoundingClientRect();
          const relLeft = rBox.left - preBox.left + pre.scrollLeft;
          const relRight = rBox.right - preBox.left + pre.scrollLeft;
          if (relLeft < -1 || relRight > pre.scrollWidth + 2) {
            outOfRange++;
          }
        }
        const moreAtStart = pre.classList.contains("more");
        pre.scrollLeft = pre.scrollWidth - pre.clientWidth;
        pre.dispatchEvent(new Event("scroll"));
        const moreAtEnd = pre.classList.contains("more");
        pre.scrollLeft = 0;
        pre.dispatchEvent(new Event("scroll"));
        return {
          ok: true,
          overflowX: style.overflowX,
          maxLead,
          lineCount: lines.length,
          outOfRange,
          scrollWidth: pre.scrollWidth,
          clientWidth: pre.clientWidth,
          moreAtStart,
          moreAtEnd,
        };
      });
      if (
        !deepCheck.ok ||
        deepCheck.overflowX !== "auto" ||
        deepCheck.outOfRange !== 0 ||
        deepCheck.scrollWidth <= deepCheck.clientWidth ||
        !deepCheck.moreAtStart ||
        deepCheck.moreAtEnd
      ) {
        throw new Error(`deep nesting check (${viewName}) failed: ${JSON.stringify(deepCheck)}`);
      }
    }

    // 2. Trace 5 sections: Completed, Advanced, Predicted, Dropped, Could read next
    await type("mi klama le le");
    await answerFor("mi klama le le");
    await page.locator("#tab-trace").click();
    await page.evaluate(() => {
      self.playground.state.trace.stage = "syntax";
      self.playground.state.trace.position = 4;
      self.playground.schedule(0);
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const hasSecs = await page.evaluate(() => document.querySelectorAll("#output .trace-sections .sec").length === 5);
      if (hasSecs) break;
      await sleep(50);
    }
    const trace5Check = await page.evaluate(() => {
      const secs = [...document.querySelectorAll("#output .trace-sections .sec")].map((s) => ({
        title: s.childNodes[0]?.textContent?.trim() || "",
        count: s.querySelector("span")?.textContent?.trim() || "",
      }));
      const lastSec = document.querySelectorAll("#output .trace-sections .sec")[4];
      const firstExpected = lastSec?.nextElementSibling;
      const hasTermSpan = !!firstExpected?.querySelector(".t");
      const hasRulesSpan = !!firstExpected?.querySelector(".muted");
      return {
        secs,
        hasTermSpan,
        hasRulesSpan,
        firstExpectedText: firstExpected?.textContent || "",
      };
    });
    if (
      trace5Check.secs.length !== 5 ||
      trace5Check.secs[4].title !== "Could read next" ||
      trace5Check.secs[4].count !== "49 items" ||
      !trace5Check.hasTermSpan ||
      !trace5Check.hasRulesSpan ||
      !/\(.+\)$/.test(trace5Check.firstExpectedText)
    ) {
      throw new Error(`Trace 5th section check failed: ${JSON.stringify(trace5Check)}`);
    }

    // 3. Token diagnostics & Elision-only Default: off wording
    await choose("grammars/eberban/refgram/pipeline.md");
    await type("a mi dona pban");
    await answerFor("a mi dona pban");
    await page.locator("#tab-tokens").click();
    await page.evaluate(() => {
      self.playground.state.tokenStage = "forms";
      self.playground.schedule(0);
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const hasErrChip = await page.evaluate(() => !!document.querySelector("#output table.tokens td.tags .tok-err"));
      if (hasErrChip) break;
      await sleep(50);
    }
    const tokDiagDesktop = await page.evaluate(() => {
      const headers = [...document.querySelectorAll("#output table.tokens th")].map((th) => th.textContent.trim());
      const pbanRow = [...document.querySelectorAll("#output table.tokens tbody tr")].find((tr) =>
        tr.textContent.includes('"pban"')
      );
      const tdText = pbanRow ? pbanRow.querySelectorAll("td")[1] : null;
      const tdTags = pbanRow ? pbanRow.querySelector("td.tags") : null;
      const rText = tdText ? tdText.getBoundingClientRect() : null;
      const rTags = tdTags ? tdTags.getBoundingClientRect() : null;
      const chipsInTagsLine = pbanRow
        ? [...pbanRow.querySelectorAll("td.tags .tag")].map((el) => ({
            text: el.textContent,
            cls: el.className,
            aria: el.getAttribute("aria-label"),
          }))
        : [];
      const elisionDesc = document.getElementById("elision-only-desc")?.textContent || "";
      const docMoreDesktopVisible = getComputedStyle(document.getElementById("doc-more-actions")).display !== "none";
      return {
        headers,
        textLeft: rText ? Math.round(rText.left) : null,
        tagsLeft: rTags ? Math.round(rTags.left) : null,
        textBottom: rText ? Math.round(rText.bottom) : null,
        tagsTop: rTags ? Math.round(rTags.top) : null,
        chipsInTagsLine,
        elisionDesc,
        docMoreDesktopVisible,
      };
    });
    if (
      tokDiagDesktop.headers.join(",") !== "#,text,value,image,span,source" ||
      Math.abs(tokDiagDesktop.tagsLeft - tokDiagDesktop.textLeft) > 1 ||
      tokDiagDesktop.tagsTop < tokDiagDesktop.textBottom - 2 ||
      tokDiagDesktop.chipsInTagsLine.length < 2 ||
      tokDiagDesktop.chipsInTagsLine[0].text !== "pair-voiceness" ||
      tokDiagDesktop.chipsInTagsLine[0].aria !== "Error: pair-voiceness" ||
      tokDiagDesktop.elisionDesc !== "Default: off" ||
      tokDiagDesktop.docMoreDesktopVisible
    ) {
      throw new Error(`desktop token diagnostics, elision wording, or doc-more check failed: ${JSON.stringify(tokDiagDesktop)}`);
    }

    // 4. Phone Token diagnostics (390px) and More actions menu
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await sleep(100);
    const phoneTokDiag = await page.evaluate(() => {
      const headers = [...document.querySelectorAll("#output table.tokens th")].map((th) => th.textContent.trim());
      const pbanRow = [...document.querySelectorAll("#output table.tokens tbody tr")].find((tr) =>
        tr.textContent.includes('"pban"')
      );
      const tdText = pbanRow ? pbanRow.querySelectorAll("td")[1] : null;
      const tdTags = pbanRow ? pbanRow.querySelector("td.tags") : null;
      const rText = tdText ? tdText.getBoundingClientRect() : null;
      const rTags = tdTags ? tdTags.getBoundingClientRect() : null;
      const chipsInTagsLine = pbanRow
        ? [...pbanRow.querySelectorAll("td.tags .tag")].map((el) => ({
            text: el.textContent,
            cls: el.className,
            aria: el.getAttribute("aria-label"),
          }))
        : [];
      return {
        headers,
        textLeft: rText ? Math.round(rText.left) : null,
        tagsLeft: rTags ? Math.round(rTags.left) : null,
        textBottom: rText ? Math.round(rText.bottom) : null,
        tagsTop: rTags ? Math.round(rTags.top) : null,
        chipsInTagsLine,
      };
    });
    if (
      phoneTokDiag.headers.join(",") !== "#,text,value,image,span,source" ||
      Math.abs(phoneTokDiag.tagsLeft - phoneTokDiag.textLeft) > 1 ||
      phoneTokDiag.tagsTop < phoneTokDiag.textBottom - 2 ||
      phoneTokDiag.chipsInTagsLine.length < 2 ||
      phoneTokDiag.chipsInTagsLine[0].text !== "pair-voiceness" ||
      phoneTokDiag.chipsInTagsLine[0].aria !== "Error: pair-voiceness"
    ) {
      throw new Error(`phone token diagnostics check failed: ${JSON.stringify(phoneTokDiag)}`);
    }

    await page.evaluate(() => {
      self.playground.openDocument("grammars/eberban/refgram/pipeline.md", 1, 1);
      const ed = self.playground.editor;
      ed.editValue(ed.getValue() + "\n");
    });
    await sleep(400);
    await page.locator("#doc-more-actions").click();
    const moreMenuCheck = await page.evaluate(() => {
      const btn = document.getElementById("doc-more-actions");
      const menu = document.getElementById("doc-more-menu");
      const btnRect = btn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const items = [...menu.querySelectorAll(".doc-more-item")].map((it) => ({
        text: it.textContent.trim(),
        disabled: it.disabled,
        hasSvg: !!it.querySelector("svg"),
        sep: it.classList.contains("sep"),
      }));
      return {
        hidden: menu.hidden,
        rightDiff: Math.abs(btnRect.right - menuRect.right),
        items,
      };
    });
    if (
      moreMenuCheck.hidden ||
      moreMenuCheck.rightDiff > 2 ||
      moreMenuCheck.items.length !== 3 ||
      moreMenuCheck.items[0].text !== "Reset pipeline" ||
      moreMenuCheck.items[0].disabled !== false ||
      moreMenuCheck.items[1].text !== "Download pipeline" ||
      moreMenuCheck.items[1].disabled !== false ||
      moreMenuCheck.items[2].text !== "Download edited (1)" ||
      moreMenuCheck.items[2].disabled !== false ||
      !moreMenuCheck.items[2].sep ||
      !moreMenuCheck.items.every((it) => it.hasSvg)
    ) {
      throw new Error(`phone More actions menu check failed: ${JSON.stringify(moreMenuCheck)}`);
    }
    await page.locator("#doc-more-reset").click();
    const activeAfterDocMoreReset = await page.evaluate(() => document.activeElement?.id || "");
    if (activeAfterDocMoreReset !== "doc-more-actions") {
      throw new Error(`More actions Reset did not return focus to #doc-more-actions: ${activeAfterDocMoreReset}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await choose("grammars/lojban/cll/pipeline.md");
    await type("mi klama le le");
    await answerFor("mi klama le le");
    const failedChipTitle = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("#stage-flow .stage")];
      return chips[chips.length - 1]?.getAttribute("title") || "";
    });
    if (failedChipTitle !== "Show tokens from indicators, read by syntax") {
      throw new Error(`failed stage chip tooltip check failed: ${failedChipTitle}`);
    }

    if ((await page.locator(".cm-content").count()) > 0) {
      await page.evaluate(() => self.playground.openDocument("grammars/lojban/cll/latin.md", 1, 1));
      const latOrigLen = await page.evaluate(() => self.playground.editor.getValue().length);
      await page.locator(".cm-content").focus();
      await page.keyboard.press("Control+Home");
      await page.keyboard.type("X");
      await page.evaluate(() => self.playground.openDocument("grammars/lojban/cll/latin.md", 5, 1));
      await page.locator(".cm-content").focus();
      await page.keyboard.press("Control+z");
      const latAfterNavUndoLen = await page.evaluate(() => self.playground.editor.getValue().length);
      if (latAfterNavUndoLen !== latOrigLen) {
        throw new Error(`same-document navigation lost undo history: ${latAfterNavUndoLen} !== ${latOrigLen}`);
      }
      await page.evaluate(() => self.playground.openDocument(null));
    }

    await type("mi klama le zarci");
    await answerFor("mi klama le zarci");
    await page.locator("#tab-brackets").click();
    await idle("returning to brackets after layout and editor checks");

    // Grammar pane width with no document open, split when a document opens, and collapsed strip at the right edge.
    await page.evaluate(() => {
      self.playground.openDocument(null);
    });
    const noDocAt1440 = await page.evaluate(() => {
      const work = document.getElementById("workspace");
      const left = document.querySelector(".left");
      const grammar = document.getElementById("grammar-pane");
      const split = document.getElementById("split-handle");
      const list = document.getElementById("documents-list-view");
      const hideSvg = document.querySelector("#hide-grammar svg");
      const workRect = work.getBoundingClientRect();
      const leftRect = left.getBoundingClientRect();
      const grammarRect = grammar.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const hideSvgRect = hideSvg.getBoundingClientRect();
      const rows = [...list.querySelectorAll(".drow")];
      const wrappedRows = rows.filter((row) => {
        const mono = row.querySelector(".mono");
        const desc = row.querySelector("span:last-child:not(.mono)");
        return mono.getBoundingClientRect().height > 24 || desc.getBoundingClientRect().height > 24;
      });
      return {
        hasNoDoc: work.classList.contains("no-doc"),
        hasStacked: work.classList.contains("no-doc-stacked"),
        splitDisplay: getComputedStyle(split).display,
        workW: Math.round(workRect.width),
        leftW: Math.round(leftRect.width),
        grammarW: Math.round(grammarRect.width),
        listW: Math.round(listRect.width),
        sameRow: Math.abs(leftRect.top - grammarRect.top) <= 1,
        wrappedCount: wrappedRows.length,
        rowCount: rows.length,
        hideIconTopOffset: Math.round(hideSvgRect.top - grammarRect.top),
      };
    });
    if (
      !noDocAt1440.hasNoDoc ||
      noDocAt1440.hasStacked ||
      noDocAt1440.splitDisplay !== "none" ||
      !noDocAt1440.sameRow ||
      Math.abs(noDocAt1440.leftW + noDocAt1440.grammarW - noDocAt1440.workW) > 1 ||
      noDocAt1440.grammarW > noDocAt1440.workW * 0.5 ||
      Math.abs(noDocAt1440.grammarW - (noDocAt1440.listW + 1)) > 2 ||
      noDocAt1440.rowCount === 0 ||
      noDocAt1440.wrappedCount !== 0
    ) {
      throw new Error(`grammar pane width with no document open failed at 1440px: ${JSON.stringify(noDocAt1440)}`);
    }

    // With no document open, the smaller minimum keeps the pane side by side at 900px and stacks cleanly at 680px.
    await page.setViewportSize({ width: 900, height: 900 });
    const noDocAt900 = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const work = document.getElementById("workspace");
      const left = document.querySelector(".left").getBoundingClientRect();
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      return {
        stacked: work.classList.contains("no-doc-stacked"),
        sameRow: Math.abs(left.top - grammar.top) <= 1,
        grammarW: Math.round(grammar.width),
        workW: Math.round(work.getBoundingClientRect().width),
      };
    });
    if (noDocAt900.stacked || !noDocAt900.sameRow || noDocAt900.grammarW > noDocAt900.workW * 0.5) {
      throw new Error(`no-doc pane did not stay side by side at 900px: ${JSON.stringify(noDocAt900)}`);
    }

    // At 820px (where the no-document list is at its minimum), path names wrap only at '/', with <wbr> in place.
    await page.setViewportSize({ width: 820, height: 900 });
    const noDocAt820 = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const work = document.getElementById("workspace");
      const leftRect = document.querySelector(".left").getBoundingClientRect();
      const grammarRect = document.getElementById("grammar-pane").getBoundingClientRect();
      const list = document.getElementById("documents-list-view");
      const row = list.querySelector('.drow[data-doc="grammars/lojban/common/consonant-tables.md"]');
      const mono = row ? row.querySelector(".mono") : null;
      const wbrs = mono ? [...mono.querySelectorAll("wbr")] : [];
      const segs = mono ? [...mono.querySelectorAll(".s")] : [];
      const segRects = segs.map((s) => ({
        text: s.textContent,
        lineCount: s.getClientRects().length,
        top: Math.round(s.getBoundingClientRect().top),
        bottom: Math.round(s.getBoundingClientRect().bottom),
      }));
      const allSegsSingleLine = [...list.querySelectorAll(".drow .mono .s")].every(
        (s) => s.getClientRects().length === 1
      );
      const totalWbrs = list.querySelectorAll(".drow .mono wbr").length;
      return {
        stacked: work.classList.contains("no-doc-stacked"),
        sameRow: Math.abs(leftRect.top - grammarRect.top) <= 1,
        wbrCount: wbrs.length,
        totalWbrs,
        segRects,
        wrappedBetweenSlashSegments:
          segRects.length === 2 &&
          segRects[0].text === "common/" &&
          segRects[1].text === "consonant-tables" &&
          segRects[1].top >= segRects[0].bottom - 2,
        allSegsSingleLine,
      };
    });
    if (
      noDocAt820.stacked ||
      !noDocAt820.sameRow ||
      noDocAt820.wbrCount !== 1 ||
      noDocAt820.totalWbrs !== 3 ||
      !noDocAt820.wrappedBetweenSlashSegments ||
      !noDocAt820.allSegsSingleLine
    ) {
      throw new Error(`no-doc minimum width slash wrap check failed at 820px: ${JSON.stringify(noDocAt820)}`);
    }

    await page.setViewportSize({ width: 680, height: 900 });
    const noDocAt680 = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const work = document.getElementById("workspace");
      const workRect = work.getBoundingClientRect();
      const leftRect = document.querySelector(".left").getBoundingClientRect();
      const grammarRect = document.getElementById("grammar-pane").getBoundingClientRect();
      return {
        stacked: work.classList.contains("no-doc-stacked"),
        belowLeft: grammarRect.top >= leftRect.bottom - 1,
        leftFull: Math.abs(leftRect.width - workRect.width) <= 1,
        grammarFull: Math.abs(grammarRect.width - workRect.width) <= 1,
      };
    });
    if (!noDocAt680.stacked || !noDocAt680.belowLeft || !noDocAt680.leftFull || !noDocAt680.grammarFull) {
      throw new Error(`no-doc stack rule failed at 680px: ${JSON.stringify(noDocAt680)}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));

    // Opening a document restores the 35/65 split (or the stored split), and closing the last document shrinks back to the list.
    await choose("grammars/lojban/examples/calculator/pipeline.md");
    await idle("calculator pipeline for 35/65 split check");
    const calcSplit = await page.evaluate(() => {
      self.playground.openDocument("grammars/lojban/examples/calculator/pipeline.md", 1, 1);
      const workW = document.getElementById("workspace").getBoundingClientRect().width;
      const leftW = document.querySelector(".left").getBoundingClientRect().width;
      const grammarW = document.getElementById("grammar-pane").getBoundingClientRect().width;
      document.getElementById("doc-close").click();
      return {
        leftRatio: leftW / workW,
        grammarRatio: grammarW / workW,
      };
    });
    if (Math.abs(calcSplit.leftRatio - 0.35) > 0.01 || Math.abs(calcSplit.grammarRatio - 0.65) > 0.01) {
      throw new Error(`35/65 split check failed on calculator pipeline: ${JSON.stringify(calcSplit)}`);
    }
    await choose("grammars/lojban/cll/pipeline.md");
    await idle("returning to lojban/cll after calculator split check");

    const splitTransition = await page.evaluate(() => {
      const work = document.getElementById("workspace");
      const left = document.querySelector(".left");
      const grammar = document.getElementById("grammar-pane");
      const split = document.getElementById("split-handle");
      const workW = work.getBoundingClientRect().width;

      self.playground.openDocument("grammars/lojban/cll/syntax.md", 1, 1);
      work.style.setProperty("--left-grow", "0");
      work.style.setProperty("--right-grow", "100");
      const leftMinW = left.getBoundingClientRect().width;
      work.style.setProperty("--left-grow", "35");
      work.style.setProperty("--right-grow", "65");
      const expectedDefaultLeftW = Math.max(workW * 0.35, leftMinW);
      const openDefault = {
        hasNoDoc: work.classList.contains("no-doc"),
        splitDisplay: getComputedStyle(split).display,
        leftW: Math.round(left.getBoundingClientRect().width),
        grammarW: Math.round(grammar.getBoundingClientRect().width),
        expectedLeftW: Math.round(expectedDefaultLeftW),
        expectedGrammarW: Math.round(workW - expectedDefaultLeftW),
      };

      split.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
      document.getElementById("doc-close").click();
      const closedAfterMove = {
        hasNoDoc: work.classList.contains("no-doc"),
        splitDisplay: getComputedStyle(split).display,
        grammarW: Math.round(grammar.getBoundingClientRect().width),
      };

      self.playground.openDocument("grammars/lojban/cll/syntax.md", 1, 1);
      const reopenedStored = {
        leftRatio: left.getBoundingClientRect().width / workW,
        grammarRatio: grammar.getBoundingClientRect().width / workW,
      };

      split.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
      document.getElementById("doc-close").click();
      const closedFinal = {
        hasNoDoc: work.classList.contains("no-doc"),
        grammarW: Math.round(grammar.getBoundingClientRect().width),
      };
      return { openDefault, closedAfterMove, reopenedStored, closedFinal };
    });
    if (
      splitTransition.openDefault.hasNoDoc ||
      splitTransition.openDefault.splitDisplay === "none" ||
      Math.abs(splitTransition.openDefault.leftW - splitTransition.openDefault.expectedLeftW) > 1 ||
      Math.abs(splitTransition.openDefault.grammarW - splitTransition.openDefault.expectedGrammarW) > 1 ||
      !splitTransition.closedAfterMove.hasNoDoc ||
      splitTransition.closedAfterMove.splitDisplay !== "none" ||
      Math.abs(splitTransition.closedAfterMove.grammarW - noDocAt1440.grammarW) > 1 ||
      Math.abs(splitTransition.reopenedStored.leftRatio - 0.45) > 0.01 ||
      Math.abs(splitTransition.reopenedStored.grammarRatio - 0.55) > 0.01 ||
      !splitTransition.closedFinal.hasNoDoc ||
      Math.abs(splitTransition.closedFinal.grammarW - noDocAt1440.grammarW) > 1
    ) {
      throw new Error(`split transition between list and open document failed: ${JSON.stringify(splitTransition)}`);
    }

    // Collapsed strip stands 36px wide at the right edge on the same row as the left side, with show icon, vertical label, and edited dot.
    const collapsedUnedited = await page.evaluate(() => {
      document.getElementById("hide-grammar").click();
      const work = document.getElementById("workspace").getBoundingClientRect();
      const left = document.querySelector(".left").getBoundingClientRect();
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      const strip = document.getElementById("show-grammar");
      const showSvg = strip.querySelector("svg").getBoundingClientRect();
      const label = strip.querySelector(".grammar-strip-label");
      const dot = document.getElementById("show-grammar-dot");
      return {
        grammarW: Math.round(grammar.width),
        sameRow: Math.abs(left.top - grammar.top) <= 1,
        rightEdge: Math.abs(grammar.right - work.right) <= 1,
        leftTakesRest: Math.abs(left.width + grammar.width - work.width) <= 1,
        iconTopOffset: Math.round(showSvg.top - grammar.top),
        iconCentered: Math.abs((showSvg.left + showSvg.right) / 2 - (grammar.left + grammar.right) / 2) <= 1,
        labelText: label ? label.textContent : "",
        writingMode: label ? getComputedStyle(label).writingMode : "",
        dotHidden: dot ? dot.hidden : null,
      };
    });
    if (
      collapsedUnedited.grammarW !== 36 ||
      !collapsedUnedited.sameRow ||
      !collapsedUnedited.rightEdge ||
      !collapsedUnedited.leftTakesRest ||
      Math.abs(collapsedUnedited.iconTopOffset - noDocAt1440.hideIconTopOffset) > 1 ||
      !collapsedUnedited.iconCentered ||
      collapsedUnedited.labelText !== "Grammar" ||
      collapsedUnedited.writingMode !== "vertical-rl" ||
      collapsedUnedited.dotHidden !== true
    ) {
      throw new Error(`collapsed strip check (unedited) failed: ${JSON.stringify(collapsedUnedited)}`);
    }

    await page.evaluate(() => {
      document.getElementById("show-grammar").click();
      self.playground.openDocument("grammars/lojban/cll/syntax.md", 1, 1);
      const ed = self.playground.editor;
      ed.editValue(ed.getValue() + "\n");
      document.getElementById("hide-grammar").click();
    });
    const collapsedEdited = await page.evaluate(() => {
      const work = document.getElementById("workspace").getBoundingClientRect();
      const left = document.querySelector(".left").getBoundingClientRect();
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      const labelRect = document.querySelector("#show-grammar .grammar-strip-label").getBoundingClientRect();
      const dot = document.getElementById("show-grammar-dot");
      const dotRect = dot.getBoundingClientRect();
      return {
        grammarW: Math.round(grammar.width),
        sameRow: Math.abs(left.top - grammar.top) <= 1,
        rightEdge: Math.abs(grammar.right - work.right) <= 1,
        dotHidden: dot.hidden,
        dotW: Math.round(dotRect.width),
        dotH: Math.round(dotRect.height),
        dotBelowLabel: dotRect.top >= labelRect.bottom - 1,
      };
    });
    if (
      collapsedEdited.grammarW !== 36 ||
      !collapsedEdited.sameRow ||
      !collapsedEdited.rightEdge ||
      collapsedEdited.dotHidden ||
      collapsedEdited.dotW !== 7 ||
      collapsedEdited.dotH !== 7 ||
      !collapsedEdited.dotBelowLabel
    ) {
      throw new Error(`collapsed strip check (edited) failed: ${JSON.stringify(collapsedEdited)}`);
    }
    await page.evaluate(() => {
      document.getElementById("show-grammar").click();
      document.getElementById("doc-reset").click();
      document.getElementById("doc-close").click();
    });
    await idle("after resetting grammar edit in collapsed strip check");

    // Transitions 900 -> 390 -> 1440 px, without and with an edited document, and closing the last document at phone width.
    await page.setViewportSize({ width: 900, height: 900 });
    const step900NoEdit = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const step390NoEdit = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const strip = document.getElementById("show-grammar");
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        stripDisplay: getComputedStyle(strip).display,
        scrollW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const step1440NoEdit = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        grammarW: Math.round(grammar.width),
      };
    });
    if (
      step900NoEdit.phone ||
      !step900NoEdit.noDoc ||
      step900NoEdit.stacked ||
      step900NoEdit.hidden ||
      !step390NoEdit.phone ||
      !step390NoEdit.noDoc ||
      !step390NoEdit.stacked ||
      step390NoEdit.hidden ||
      step390NoEdit.stripDisplay !== "none" ||
      step390NoEdit.scrollW > step390NoEdit.winW ||
      step1440NoEdit.phone ||
      !step1440NoEdit.noDoc ||
      step1440NoEdit.stacked ||
      step1440NoEdit.hidden ||
      Math.abs(step1440NoEdit.grammarW - noDocAt1440.grammarW) > 1
    ) {
      throw new Error(
        `900 -> 390 -> 1440 transition (no edit) failed: ${JSON.stringify({ step900NoEdit, step390NoEdit, step1440NoEdit })}`
      );
    }

    await page.setViewportSize({ width: 900, height: 900 });
    const step900Edited = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      self.playground.openDocument("grammars/lojban/cll/syntax.md", 1, 1);
      const ed = self.playground.editor;
      ed.editValue(ed.getValue() + "\n");
      document.getElementById("hide-grammar").click();
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      const dot = document.getElementById("show-grammar-dot");
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        grammarW: Math.round(grammar.width),
        dotHidden: dot.hidden,
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const step390Edited = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const strip = document.getElementById("show-grammar");
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        stripDisplay: getComputedStyle(strip).display,
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const step1440Edited = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const workRect = work.getBoundingClientRect();
      const leftRect = document.querySelector(".left").getBoundingClientRect();
      const grammarRect = document.getElementById("grammar-pane").getBoundingClientRect();
      const strip = document.getElementById("show-grammar");
      const dot = document.getElementById("show-grammar-dot");
      const dotRect = dot.getBoundingClientRect();
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        stripDisplay: getComputedStyle(strip).display,
        grammarW: Math.round(grammarRect.width),
        sameRow: Math.abs(leftRect.top - grammarRect.top) <= 1,
        rightEdge: Math.abs(grammarRect.right - workRect.right) <= 1,
        dotHidden: dot.hidden,
        dotW: Math.round(dotRect.width),
        dotH: Math.round(dotRect.height),
      };
    });
    if (
      step900Edited.phone ||
      step900Edited.noDoc ||
      step900Edited.stacked ||
      !step900Edited.hidden ||
      step900Edited.grammarW !== 36 ||
      step900Edited.dotHidden ||
      !step390Edited.phone ||
      step390Edited.noDoc ||
      step390Edited.stacked ||
      !step390Edited.hidden ||
      step390Edited.stripDisplay !== "none" ||
      step1440Edited.phone ||
      step1440Edited.noDoc ||
      step1440Edited.stacked ||
      !step1440Edited.hidden ||
      step1440Edited.stripDisplay !== "flex" ||
      step1440Edited.grammarW !== 36 ||
      !step1440Edited.sameRow ||
      !step1440Edited.rightEdge ||
      step1440Edited.dotHidden ||
      step1440Edited.dotW !== 7 ||
      step1440Edited.dotH !== 7
    ) {
      throw new Error(
        `900 -> 390 -> 1440 transition (edited + strip) failed: ${JSON.stringify({ step900Edited, step390Edited, step1440Edited })}`
      );
    }

    await page.evaluate(() => {
      document.getElementById("show-grammar").click();
      document.getElementById("doc-reset").click();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const closedAt390 = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      document.getElementById("doc-close").click();
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const strip = document.getElementById("show-grammar");
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        stripDisplay: getComputedStyle(strip).display,
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const afterCloseAt1440 = await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      const app = document.getElementById("app");
      const work = document.getElementById("workspace");
      const grammar = document.getElementById("grammar-pane").getBoundingClientRect();
      return {
        phone: app.classList.contains("phone"),
        noDoc: work.classList.contains("no-doc"),
        stacked: work.classList.contains("no-doc-stacked"),
        hidden: work.classList.contains("grammar-hidden"),
        grammarW: Math.round(grammar.width),
      };
    });
    if (
      !closedAt390.phone ||
      !closedAt390.noDoc ||
      !closedAt390.stacked ||
      closedAt390.hidden ||
      closedAt390.stripDisplay !== "none" ||
      afterCloseAt1440.phone ||
      !afterCloseAt1440.noDoc ||
      afterCloseAt1440.stacked ||
      afterCloseAt1440.hidden ||
      Math.abs(afterCloseAt1440.grammarW - noDocAt1440.grammarW) > 1
    ) {
      throw new Error(
        `close last document at 390 -> 1440 transition failed: ${JSON.stringify({ closedAt390, afterCloseAt1440 })}`
      );
    }
    await idle("after 900 -> 390 -> 1440 and phone close checks");

    console.log(`redesigned layout, full editor, and phone checks work in ${browser}`);

    // Basic editor variant: served without playground/vendor/, with zero failed requests.
    const basicPage = await instance.newPage();
    const basicFailedRequests = [];
    basicPage.on("requestfailed", (req) => {
      basicFailedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText || "failed"})`);
    });
    basicPage.on("response", (res) => {
      if (res.status() >= 400) {
        basicFailedRequests.push(`${res.request().method()} ${res.url()} (HTTP ${res.status()})`);
      }
    });
    if (fs.existsSync(path.join(repository, "playground/vendor/codemirror.js"))) {
      const basicGrammarsBody = fs
        .readFileSync(path.join(repository, "dist/grammars.js"), "utf8")
        .replace('root.gencmuEditor = "full";', 'root.gencmuEditor = "basic";');
      await basicPage.route("**/dist/grammars.js", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: basicGrammarsBody })
      );
      await basicPage.route("**/playground/vendor/**", (route) => route.fulfill({ status: 404, body: "missing" }));
      await basicPage.route("**/playground/editor-full.js", (route) => route.fulfill({ status: 404, body: "missing" }));
    } else if (fs.existsSync(path.join(repository, "playground/editor-full.js"))) {
      throw new Error("basic build still ships playground/editor-full.js");
    }
    await basicPage.goto(target);
    const basicStarted = await (async () => {
      for (let attempt = 0; attempt < 600; attempt++) {
        const val = await basicPage.evaluate(() => {
          const status = document.getElementById("status");
          return status && ["ready", "error"].includes(status.dataset.state)
            ? { state: status.dataset.state, variant: self.playground?.editor?.variant, caps: self.playground?.editor?.capabilities }
            : null;
        });
        if (val !== null) return val;
        await sleep(100);
      }
      throw new Error("timed out waiting for basic editor variant to start");
    })();
    if (
      basicStarted.state !== "ready" ||
      basicStarted.variant !== "basic" ||
      basicStarted.caps?.syntaxColors !== false ||
      basicStarted.caps?.wrappedLineNumbers !== false ||
      basicStarted.caps?.marginMarks !== false
    ) {
      throw new Error(`basic editor variant did not initialize as expected: ${JSON.stringify(basicStarted)}`);
    }
    await basicPage.evaluate(() => {
      const btn = document.querySelector('#examples-menu button[data-example-id="clause-erasure-sa"]');
      if (!btn) throw new Error("missing clause-erasure-sa in basic editor examples menu");
      btn.click();
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const exLoaded = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const result = document.getElementById("result");
        return status.dataset.state === "ready" &&
          !result.hasAttribute("aria-busy") &&
          result.dataset.for.includes("badna")
          ? true
          : null;
      });
      if (exLoaded) break;
      await sleep(100);
    }
    const basicOpened = await basicPage.evaluate(() => {
      const ta = document.getElementById("doc-text");
      const cur = self.playground.editor.getCursor();
      const menuHead = document.querySelector("#examples-menu .mgroup")?.textContent || "";
      const menuFoot = document.querySelector("#examples-menu .ex-foot")?.textContent || "";
      const noteLink = document.getElementById("example-hint-rule")?.textContent || "";
      return {
        hasTextarea: ta instanceof HTMLTextAreaElement,
        hasCm: !!document.querySelector("#editor-body .cm-editor"),
        label: ta ? ta.getAttribute("aria-label") : null,
        lineText: cur.lineText,
        menuHead,
        menuFoot,
        noteLink,
      };
    });
    if (
      !basicOpened.hasTextarea ||
      basicOpened.hasCm ||
      basicOpened.label !== "stream.md" ||
      basicOpened.lineText !== "%rule sa-erasure" ||
      basicOpened.menuHead !== "Examples for lojban/cll" ||
      basicOpened.menuFoot !== "Other pipelines have 23 more examples." ||
      basicOpened.noteLink !== "Open common/stream.md at sa-erasure"
    ) {
      throw new Error(`basic editor did not open stream.md on %rule sa-erasure via example: ${JSON.stringify(basicOpened)}`);
    }
    await basicPage.evaluate(() => {
      self.playground.openDocument("grammars/lojban/cll/syntax.md", 345, 1);
    });
    await basicPage.evaluate(() => {
      const ed = self.playground.editor;
      ed.editValue(ed.getValue().replace("sumti-tail [+KU", "sumti-tali [+KU"));
      ed.goTo(1, 1);
    });
    for (let attempt = 0; attempt < 600; attempt++) {
      const readyErr = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const bar = document.getElementById("doc-error-bar");
        return status.dataset.state === "ready" && bar && !bar.hidden ? true : null;
      });
      if (readyErr) break;
      await sleep(100);
    }
    await basicPage.locator("#doc-error-jump").click();
    const basicJumped = await basicPage.evaluate(() => ({
      lineText: self.playground.editor.getCursor().lineText,
      srText: document.getElementById("editor-error-sr")?.textContent || "",
    }));
    if (basicJumped.lineText !== "%rule sumti-6" || !/^Line \d+, error:/.test(basicJumped.srText)) {
      throw new Error(`basic editor Go to line:column or sr text failed: ${JSON.stringify(basicJumped)}`);
    }
    await basicPage.locator("#doc-reset").click();
    for (let attempt = 0; attempt < 600; attempt++) {
      const restored = await basicPage.evaluate(() => {
        const status = document.getElementById("status");
        const bar = document.getElementById("doc-error-bar");
        const badge = document.querySelector("#summary .badge");
        return status.dataset.state === "ready" && bar?.hidden && badge?.textContent === "Accepted" ? true : null;
      });
      if (restored) break;
      await sleep(100);
    }
    if (basicFailedRequests.length > 0) {
      throw new Error(`basic editor variant had failed network requests: ${basicFailedRequests.join("; ")}`);
    }
    console.log(`basic editor variant works in ${browser}`);
    console.log(`playground works in ${browser} at ${target}, ${version}`);
  } finally {
    await instance.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
